import {
  Ban,
  CircleCheck,
  KeyRound,
  Link2Off,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { LabelKey } from '@attendance/shared';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  PanelTabs,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { RemoveDialog } from '../components/RemoveDialog';
import { RevealSecret } from '../components/RevealSecret';
import { StaffPicker } from '../components/StaffPicker';
import { Badge, Button, CheckCard, Field, SelectField } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDate, formatDateTime } from '../lib/operations-api';
import {
  USER_STATUS_LABELS,
  USER_STATUS_TONES,
  appClientsApi,
  usersApi,
  type AccountCandidate,
  type AccountRoleOption,
  type AppClientRow,
  type UserCounts,
  type UserPage,
  type UserRow,
  type UserStatus,
} from '../lib/settings-api';
import { T, TEnum, useLabels } from '../lib/translation';

const APPS_SCREEN = 'settings.users.apps';

/** The permission screen for an account type. Each is its own grant on the server. */
function accountScreen(accountType: 'admin' | 'staff'): string {
  return accountType === 'admin' ? 'settings.users.admin' : 'settings.users.staff';
}

/** The policy default, used only until the first list read reports the configured value. */
const DEFAULT_PASSWORD_MIN = 12;

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
    <PanelCard title={<T k="users.title" />} subtitle={<T k="users.subtitle" />}>
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

function StatusBadge({ status }: { status: UserStatus }): ReactNode {
  return (
    // Upper case comes from the class: `.toUpperCase()` on a translated word is not safe.
    <Badge tone={USER_STATUS_TONES[status] ?? 'neutral'} className="uppercase">
      <TEnum k={USER_STATUS_LABELS[status]} fallback={status} />
    </Badge>
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
  const [roleId, setRoleId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<UserPage | null>(null);
  const [roles, setRoles] = useState<AccountRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [suspending, setSuspending] = useState<UserRow | null>(null);
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const screen = accountScreen(accountType);
  const admin = accountType === 'admin';
  const minLength = data?.limits.passwordMinLength ?? DEFAULT_PASSWORD_MIN;

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
          ...(roleId !== '' ? { roleId: Number(roleId) } : {}),
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
  }, [accountType, status, roleId, debounced, page, pageSize, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void usersApi
      .roles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  /** Reactivation only. Suspending goes through its confirmation. */
  async function reactivate(row: UserRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await usersApi.update(row.id, { status: 'active' });
      setNotice(t('users.reactivated', { email: row.email }));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.status'));
    }
  }

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        title={
          <T
            k={admin ? 'users.count.admin' : 'users.count.staff'}
            vars={{ count: new Intl.NumberFormat('ms-MY').format(data?.total ?? 0) }}
          />
        }
        subtitle={
          <T k={admin ? 'users.section.admin.subtitle' : 'users.section.staff.subtitle'} />
        }
        action={
          can(screen, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k={admin ? 'users.action.newAdmin' : 'users.action.newStaff'} />
            </Button>
          ) : undefined
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
        dirty={search.length > 0 || status !== undefined || roleId !== ''}
        onReset={() => {
          setSearch('');
          setStatus(undefined);
          setRoleId('');
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('users.filter.roles')}
          value={roleId}
          onChange={(value) => {
            setRoleId(value);
            setPage(1);
          }}
          options={roles.map((role) => ({ value: String(role.id), label: role.name }))}
        />
      </FilterRow>

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={rows.length}
        empty={<T k={admin ? 'users.empty.admin' : 'users.empty.staff'} />}
        columns={
          admin
            ? [
                { header: <T k="users.column.email" />, width: 'w-64' },
                { header: <T k="users.column.role" />, width: 'w-40' },
                { header: <T k="users.column.twoFactor" />, width: 'w-36' },
                { header: <T k="users.column.lastLogin" /> },
                { header: <T k="panel.column.created" />, width: 'w-28' },
                { header: <T k="panel.column.status" />, width: 'w-32' },
                { header: <T k="panel.column.actions" />, width: 'w-40', align: 'right' },
              ]
            : [
                { header: <T k="users.column.email" />, width: 'w-56' },
                { header: <T k="users.column.staff" /> },
                { header: <T k="users.column.device" />, width: 'w-32' },
                { header: <T k="users.column.lastLogin" />, width: 'w-40' },
                { header: <T k="panel.column.status" />, width: 'w-32' },
                { header: <T k="panel.column.actions" />, width: 'w-40', align: 'right' },
              ]
        }
      >
        {rows.map((row) => (
          <AccountRow
            key={row.id}
            row={row}
            admin={admin}
            screen={screen}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onEdit={() => setEditing(row)}
            onReset={() => setResetting(row)}
            onSuspend={() => setSuspending(row)}
            onReactivate={() => void reactivate(row)}
            onDelete={() => setRemoving(row)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
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
          minLength={minLength}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            setError(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {editing !== null && (
        <EditAccountDialog
          account={editing}
          roles={roles}
          screen={screen}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setError(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {resetting !== null && (
        <ResetPasswordDialog
          account={resetting}
          minLength={minLength}
          onClose={() => setResetting(null)}
          onSaved={(message) => {
            setResetting(null);
            setError(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {suspending !== null && (
        <RemoveDialog
          title={<T k="users.suspend.title" vars={{ email: suspending.email }} />}
          titleText={t('users.suspend.title', { email: suspending.email })}
          description={<T k="users.suspend.body" />}
          submitLabel={<T k="users.suspend.submit" />}
          onConfirm={async () => {
            await usersApi.update(suspending.id, { status: 'suspended' });
            setSuspending(null);
            setError(null);
            setNotice(t('users.suspended', { email: suspending.email }));
            refresh();
          }}
          onClose={() => setSuspending(null)}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="users.remove.title" vars={{ email: removing.email }} />}
          titleText={t('users.remove.title', { email: removing.email })}
          description={<T k="users.remove.suspended" />}
          onConfirm={async () => {
            await usersApi.remove(removing.id);
            setRemoving(null);
            setError(null);
            setNotice(t('users.removed', { email: removing.email }));
            refresh();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

function AccountRow({
  row,
  admin,
  screen,
  expanded,
  onToggle,
  onEdit,
  onReset,
  onSuspend,
  onReactivate,
  onDelete,
}: {
  row: UserRow;
  admin: boolean;
  screen: string;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onReset: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onDelete: () => void;
}): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  const locked = row.lockedUntil !== null && new Date(row.lockedUntil) > new Date();
  const suspended = row.status === 'suspended';
  // A login that outlived its person: the directory says gone, the account still opens.
  const orphaned = row.staff !== null && !row.staff.active && !suspended;

  const mayEdit = can(screen, 'edit') || (!admin && can(screen, 'unbind'));
  const mayToggle = can(screen, suspended ? 'activate' : 'suspend');

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          /*
            Tinted so scanning the list surfaces these before the status column is read: rose for a
            login that is cut off, amber for one that needs somebody to act — locked out, or still
            open for a person the directory has already deactivated.
          */
          !expanded && suspended && 'bg-rose-50/40',
          !expanded && !suspended && (locked || orphaned) && 'bg-amber-50/40',
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
            <td className="px-2 py-2.5">
              {row.twoFactorEnabled ? (
                <Badge tone="success" className="uppercase">
                  <ShieldCheck className="size-3" aria-hidden />
                  <T k="users.twoFactor.on" />
                </Badge>
              ) : (
                <Badge tone="warning" className="uppercase">
                  <T k="users.twoFactor.off" />
                </Badge>
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
                  <span className="flex flex-wrap items-center gap-1.5 text-slate-800">
                    {row.staff.fullName}
                    {!row.staff.active && (
                      <Badge tone="warning" className="uppercase">
                        <T k="users.staffInactive" />
                      </Badge>
                    )}
                  </span>
                  <span className="block text-[11px] tracking-wide text-slate-400 uppercase">
                    {row.staff.department?.name ?? t('users.noDepartment')}
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
                <span className="font-mono text-[11px] text-slate-600" title={row.boundDeviceId}>
                  {row.boundDeviceId.slice(0, 10)}…
                </span>
              )}
            </td>
          </>
        )}

        <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
          {row.lastLoginAt === null ? t('users.never') : formatDateTime(row.lastLoginAt)}
        </td>

        {admin && (
          <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
            {formatDate(row.createdAt)}
          </td>
        )}

        <td className="px-2 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge status={row.status} />
            {locked && (
              <Badge tone="danger" className="uppercase">
                <T k="users.locked" />
              </Badge>
            )}
          </div>
        </td>

        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            {mayEdit && (
              <RowAction
                icon={<Pencil className="size-4" aria-hidden />}
                label={t('users.action.edit')}
                tone="edit"
                onClick={onEdit}
              />
            )}
            {can(screen, 'reset') && (
              <RowAction
                icon={<KeyRound className="size-4" aria-hidden />}
                label={t('users.action.reset')}
                tone="success"
                onClick={onReset}
              />
            )}
            {/*
              The suspend toggle. Suspending ends live sessions immediately, which is the whole
              point of it existing next to delete: it stops access now and keeps the record.
            */}
            {mayToggle && (
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
                onClick={suspended ? onReactivate : onSuspend}
              />
            )}
            {can(screen, 'delete') && (
              <RowAction
                icon={<Trash2 className="size-4" aria-hidden />}
                label={suspended ? t('users.action.remove') : t('users.action.suspendFirst')}
                tone="danger"
                disabled={!suspended}
                onClick={onDelete}
              />
            )}
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
              <Detail
                label={<T k="users.detail.accountType" />}
                value={
                  <T
                    k={
                      row.accountType === 'admin'
                        ? 'users.detail.accountType.admin'
                        : 'users.detail.accountType.staff'
                    }
                  />
                }
              />
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

            {orphaned && (
              <PanelNote
                tone="warn"
                icon={<TriangleAlert className="size-3.5" aria-hidden />}
                className="mt-3"
              >
                <T k="users.detail.staffInactiveWarning" />
              </PanelNote>
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

/** Platform names are proper nouns, shown as the create form offers them. */
const PLATFORM_NAMES: Record<AppClientRow['platform'], string> = {
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
};

function AppsPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const [rows, setRows] = useState<AppClientRow[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AppClientRow | null>(null);
  const [suspending, setSuspending] = useState<AppClientRow | null>(null);
  const [rotating, setRotating] = useState<AppClientRow | null>(null);
  const [removing, setRemoving] = useState<AppClientRow | null>(null);
  const [revealed, setRevealed] = useState<{ clientId: string; secret: string; note: string } | null>(
    null,
  );
  const { t } = useLabels();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await appClientsApi.list());
      setLoadedAt(new Date().toISOString());
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

  /** Reactivation only. Suspending goes through its confirmation. */
  async function reactivate(row: AppClientRow): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await appClientsApi.update(row.id, { status: 'active' });
      setNotice(t('users.apps.reactivated', { name: row.name }));
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.status'));
    }
  }

  const all = rows ?? [];
  const needle = search.trim().toLowerCase();
  const searched = all.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      row.clientId.toLowerCase().includes(needle),
  );
  const filtered =
    statusFilter === undefined ? searched : searched.filter((row) => row.status === statusFilter);

  // Counted over the search but not over the chip, so choosing one does not zero the other.
  const counts = {
    active: searched.filter((row) => row.status === 'active').length,
    suspended: searched.filter((row) => row.status === 'suspended').length,
  };

  return (
    <>
      <PanelSection
        title={<T k="users.apps.count" vars={{ count: all.length }} />}
        subtitle={<T k="users.apps.subtitle" />}
        action={
          can(APPS_SCREEN, 'create') ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              <T k="users.apps.action.add" />
            </Button>
          ) : undefined
        }
      />

      <ChipBar
        active={statusFilter}
        onChange={setStatusFilter}
        chips={[
          {
            id: 'active',
            label: <T k="app.status.active" />,
            count: counts.active,
            dot: 'bg-emerald-500',
          },
          {
            id: 'suspended',
            label: <T k="userStatus.suspended" />,
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

      {/* One note: what to do when a secret leaks, which is the decision this tab exists for. */}
      <PanelBody className="space-y-2 pb-0">
        <Feedback error={error} notice={notice} />
        <PanelNote icon={<Smartphone className="size-3.5" aria-hidden />}>
          <T k="users.apps.note" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="users.apps.empty" />}
        columns={[
          { header: <T k="users.apps.column.name" /> },
          { header: <T k="users.apps.column.platform" />, width: 'w-28' },
          { header: <T k="users.apps.column.minVersion" />, width: 'w-32' },
          { header: <T k="panel.column.created" />, width: 'w-28' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-40', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const suspended = row.status === 'suspended';
          const expanded = open === row.id;
          return (
            <Fragment key={row.id}>
              <tr
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
                  <Badge tone="neutral">{PLATFORM_NAMES[row.platform] ?? row.platform}</Badge>
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
                <td className="px-2 py-2.5 text-xs whitespace-nowrap text-slate-500">
                  {formatDate(row.createdAt)}
                </td>
                <td className="px-2 py-2.5">
                  <Badge tone={suspended ? 'danger' : 'success'} className="uppercase">
                    <T k={suspended ? 'userStatus.suspended' : 'app.status.active'} />
                  </Badge>
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    {can(APPS_SCREEN, 'edit') && (
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('users.apps.action.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
                    )}
                    {can(APPS_SCREEN, 'rotate') && (
                      <RowAction
                        icon={<RefreshCw className="size-4" aria-hidden />}
                        label={t('users.apps.action.rotate')}
                        tone="edit"
                        onClick={() => setRotating(row)}
                      />
                    )}
                    {can(APPS_SCREEN, suspended ? 'activate' : 'suspend') && (
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
                        onClick={() => (suspended ? void reactivate(row) : setSuspending(row))}
                      />
                    )}
                    {can(APPS_SCREEN, 'delete') && (
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          suspended
                            ? t('users.apps.action.remove')
                            : t('users.action.suspendFirst')
                        }
                        tone="danger"
                        disabled={!suspended}
                        onClick={() => setRemoving(row)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('users.apps.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td colSpan={6} className="px-5 py-3">
                    <DetailGrid>
                      <Detail
                        label={<T k="users.apps.detail.clientId" />}
                        value={row.clientId}
                        mono
                      />
                      <Detail
                        label={<T k="users.apps.column.platform" />}
                        value={PLATFORM_NAMES[row.platform] ?? row.platform}
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
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={all.length}
        page={1}
        pageSize={Math.max(1, all.length)}
        pageSizes={[Math.max(1, all.length)]}
        generatedAt={loadedAt}
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

      {editing !== null && (
        <EditAppClientDialog
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setError(null);
            setNotice(t('users.apps.updated', { name: editing.name }));
            refresh();
          }}
        />
      )}

      {revealed !== null && (
        <RevealSecret
          title={t('users.apps.secret.title')}
          identifier={{ label: t('users.apps.secret.clientId'), value: revealed.clientId }}
          label={t('users.apps.secret.secret')}
          value={revealed.secret}
          note={revealed.note}
          onClose={() => setRevealed(null)}
        />
      )}

      {suspending !== null && (
        <RemoveDialog
          title={<T k="users.apps.suspend.title" vars={{ name: suspending.name }} />}
          titleText={t('users.apps.suspend.title', { name: suspending.name })}
          description={<T k="users.apps.suspend.body" />}
          submitLabel={<T k="users.suspend.submit" />}
          onConfirm={async () => {
            await appClientsApi.update(suspending.id, { status: 'suspended' });
            setSuspending(null);
            setError(null);
            setNotice(t('users.apps.suspended', { name: suspending.name }));
            refresh();
          }}
          onClose={() => setSuspending(null)}
        />
      )}

      {rotating !== null && (
        <RemoveDialog
          title={<T k="users.apps.rotate.title" vars={{ name: rotating.name }} />}
          titleText={t('users.apps.rotate.title', { name: rotating.name })}
          description={<T k="users.apps.rotate.body" />}
          submitLabel={<T k="users.apps.rotate.submit" />}
          onConfirm={async () => {
            const outcome = await appClientsApi.update(rotating.id, { rotateSecret: true });
            setRotating(null);
            setError(null);
            if (outcome.secret !== undefined) {
              setRevealed({
                clientId: rotating.clientId,
                secret: outcome.secret,
                note: t(outcome.noteKey ?? 'users.apps.secret.rotated'),
              });
            }
            refresh();
          }}
          onClose={() => setRotating(null)}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="users.apps.remove.title" vars={{ name: removing.name }} />}
          titleText={t('users.apps.remove.title', { name: removing.name })}
          description={<T k="users.apps.remove.body" />}
          onConfirm={async () => {
            await appClientsApi.remove(removing.id);
            setRemoving(null);
            setError(null);
            setNotice(t('users.apps.removed', { name: removing.name }));
            refresh();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** The edit form's status options. A select option, so its own words rather than the badge's. */
const EDIT_STATUS_LABELS: Record<UserStatus, LabelKey> = {
  active: 'users.edit.status.active',
  pending: 'users.edit.status.pending',
  suspended: 'users.edit.status.suspended',
};

/** One option per role, with how much it grants beside the name. */
function roleOption(role: AccountRoleOption, t: ReturnType<typeof useLabels>['t']): ReactNode {
  return (
    <option key={role.id} value={role.id}>
      {t('users.create.role.option', {
        name: role.name,
        granted: role.permissionCount,
        total: role.permissionTotal,
      })}
    </option>
  );
}

function CreateAccountDialog({
  accountType,
  roles,
  minLength,
  onClose,
  onSaved,
}: {
  accountType: 'admin' | 'staff';
  roles: AccountRoleOption[];
  minLength: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const [chosen, setChosen] = useState<AccountCandidate | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [allowAppCheckIn, setAllowAppCheckIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /*
    Active roles only. An inactive role refuses login to everyone holding it, so issuing a new
    account under one creates a login that cannot be used.
  */
  const offered = useMemo(() => roles.filter((role) => role.status === 'active'), [roles]);

  useEffect(() => {
    if (roleId !== null || offered.length === 0) return;
    // Defaults to the least privileged role rather than the first listed, so a
    // mis-click on save does not hand out administration.
    const fewest = [...offered].sort(
      (left, right) => left.permissionCount - right.permissionCount,
    )[0];
    if (fewest) setRoleId(fewest.id);
  }, [roleId, offered]);

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
      // Two sentences, joined: the server's note, when it sends one, is a sentence of its own.
      onSaved(
        [
          t('users.created', { name: chosen.fullName }),
          ...(outcome.noteKey === undefined ? [] : [t(outcome.noteKey)]),
        ].join(' '),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.error.create'));
    } finally {
      setBusy(false);
    }
  }

  const titleKey = accountType === 'admin' ? 'users.create.admin' : 'users.create.staff';
  const short = password.length > 0 && password.length < minLength;

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      description={
        <T
          k={accountType === 'admin' ? 'users.create.description' : 'users.create.description.staff'}
        />
      }
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Name first, then the form — the same two stages as every form that names a person. */}
        <StaffPicker<AccountCandidate>
          value={chosen}
          onChange={(candidate) => {
            setChosen(candidate);
            setEmail(candidate?.email ?? '');
          }}
          search={(query) => usersApi.searchStaff(query)}
          hint={<T k="users.create.searchStaff.hint" />}
          unavailable={(candidate) =>
            candidate.existingAccountEmail === null ? undefined : (
              <T k="users.create.taken" vars={{ email: candidate.existingAccountEmail }} />
            )
          }
        />

        {chosen !== null && (
          <>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label={<T k="users.create.email" />}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                wrapperClassName="sm:col-span-2"
              />
              <SelectField
                label={<T k="users.create.role" />}
                value={roleId ?? ''}
                onChange={(event) => setRoleId(Number(event.target.value))}
              >
                {offered.map((role) => roleOption(role, t))}
              </SelectField>
              <Field
                label={<T k="users.create.password" />}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                hint={<T k="users.create.password.hint" vars={{ count: minLength }} />}
                error={
                  short
                    ? t('users.create.password.short', { count: minLength - password.length })
                    : undefined
                }
              />
            </div>

            <div className="space-y-2 pb-2">
              {accountType === 'staff' && (
                <CheckCard
                  checked={allowAppCheckIn}
                  onChange={setAllowAppCheckIn}
                  icon={<Smartphone className="size-4" aria-hidden />}
                  title={<T k="users.create.allowAppCheckIn" />}
                  hint={<T k="users.create.allowAppCheckIn.hint" />}
                />
              )}
              {accountType === 'admin' && (
                <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                  <T k="users.create.adminWarning" />
                </PanelNote>
              )}
            </div>

            <DialogFooter
              onClose={onClose}
              onSubmit={() => void submit()}
              busy={busy}
              disabled={email.trim().length === 0 || password.length < minLength || roleId === null}
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
  screen,
  onClose,
  onSaved,
}: {
  account: UserRow;
  roles: AccountRoleOption[];
  screen: string;
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
  const { can } = useAuth();

  /*
    Each field carries its own permission on the server — role and app check-in need `edit`,
    each status its own verb, the binding `unbind` — so each control is offered only to somebody
    whose save it would not refuse.
  */
  const mayEdit = can(screen, 'edit');
  const statuses = (['active', 'pending', 'suspended'] as UserStatus[]).filter(
    (option) =>
      option === account.status ||
      (option === 'active' && can(screen, 'activate')) ||
      (option === 'suspended' && can(screen, 'suspend')) ||
      (option === 'pending' && mayEdit),
  );
  const mayUnbind = account.accountType === 'staff' && can(screen, 'unbind');
  // The current role stays listed even when inactive, so the select shows what the account holds.
  const offered = roles.filter((role) => role.status === 'active' || role.id === account.role.id);

  const changed =
    roleId !== account.role.id ||
    status !== account.status ||
    allowAppCheckIn !== account.allowAppCheckIn ||
    resetBinding;

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
    <Dialog
      title={account.email}
      description={account.staff?.fullName}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <SelectField
            label={<T k="users.create.role" />}
            value={roleId}
            onChange={(event) => setRoleId(Number(event.target.value))}
            disabled={!mayEdit}
          >
            {offered.map((role) => roleOption(role, t))}
          </SelectField>

          <SelectField
            label={<T k="users.edit.status" />}
            value={status}
            onChange={(event) => setStatus(event.target.value as UserStatus)}
            disabled={statuses.length < 2}
            hint={
              status === 'suspended' && account.status !== 'suspended' ? (
                <T k="users.edit.status.warning" />
              ) : undefined
            }
          >
            {statuses.map((option) => (
              <option key={option} value={option}>
                {t(EDIT_STATUS_LABELS[option])}
              </option>
            ))}
          </SelectField>
        </div>

        {(account.accountType === 'staff' || (account.boundDeviceId !== null && mayUnbind)) && (
          <div className="space-y-2 pb-2">
            {account.accountType === 'staff' && (
              <CheckCard
                checked={allowAppCheckIn}
                onChange={setAllowAppCheckIn}
                disabled={!mayEdit}
                icon={<Smartphone className="size-4" aria-hidden />}
                title={<T k="users.create.allowAppCheckIn" />}
                hint={<T k="users.create.allowAppCheckIn.hint" />}
              />
            )}
            {account.boundDeviceId !== null && mayUnbind && (
              <CheckCard
                checked={resetBinding}
                onChange={setResetBinding}
                icon={<Link2Off className="size-4" aria-hidden />}
                title={<T k="users.edit.resetBinding" />}
                hint={<T k="users.edit.resetBinding.hint" />}
              />
            )}
          </div>
        )}

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={!changed}
        />
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
  minLength,
  onClose,
  onSaved,
}: {
  account: UserRow;
  minLength: number;
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
      width="lg"
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
          hint={<T k="users.reset.password.hint" vars={{ count: minLength }} />}
          error={
            password.length > 0 && password.length < minLength
              ? t('users.create.password.short', { count: minLength - password.length })
              : undefined
          }
        />

        <div className="pb-2">
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="users.reset.warning" />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={password.length < minLength}
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
  const [platform, setPlatform] = useState<AppClientRow['platform']>('android');
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
      onCreated({
        clientId: outcome.clientId,
        secret: outcome.secret,
        // The key the server sent, resolved here. It used to be read as `note`, which the server
        // no longer sends, so the strip saying this is the only viewing rendered empty.
        note: t(outcome.noteKey),
      });
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
      width="lg"
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

        <div className="grid items-start gap-4 pb-2 sm:grid-cols-2">
          <SelectField
            label={<T k="users.apps.create.platform" />}
            value={platform}
            onChange={(event) => setPlatform(event.target.value as AppClientRow['platform'])}
          >
            {(Object.keys(PLATFORM_NAMES) as Array<AppClientRow['platform']>).map((key) => (
              <option key={key} value={key}>
                {PLATFORM_NAMES[key]}
              </option>
            ))}
          </SelectField>

          <Field
            label={<T k="users.apps.create.minVersion" />}
            value={minVersion}
            onChange={(event) => setMinVersion(event.target.value)}
            placeholder="1.0.0"
            hint={<T k="users.apps.create.minVersion.hint" />}
          />
        </div>

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

/**
 * Raises or clears a client's minimum version.
 *
 * The soft form of suspension: builds older than this are refused, which forces an update without
 * cutting anybody off. Only useful after the client exists — which is when the screen had no
 * control for it.
 */
function EditAppClientDialog({
  client,
  onClose,
  onSaved,
}: {
  client: AppClientRow;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const [minVersion, setMinVersion] = useState(client.minVersion ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await appClientsApi.update(client.id, { minVersion: minVersion.trim() });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('users.apps.error.update'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="users.apps.edit.title" vars={{ name: client.name }} />}
      titleText={t('users.apps.edit.title', { name: client.name })}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div className="pb-2">
          <Field
            label={<T k="users.apps.create.minVersion" />}
            value={minVersion}
            onChange={(event) => setMinVersion(event.target.value)}
            placeholder="1.0.0"
            hint={<T k="users.apps.create.minVersion.hint" />}
            autoFocus
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={minVersion.trim() === (client.minVersion ?? '')}
        />
      </div>
    </Dialog>
  );
}
