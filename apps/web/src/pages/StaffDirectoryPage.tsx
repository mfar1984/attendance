import {
  Eye,
  Fingerprint,
  IdCard,
  KeyRound,
  Pencil,
  Plus,
  ScanFace,
  TriangleAlert,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
  ChipBar,
  FacetSelect,
  FilterRow,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { StaffDeactivateDialog } from '../components/StaffDeactivateDialog';
import { StaffFormDialog } from '../components/StaffFormDialog';
import { Badge, Button } from '../components/ui';
import { staffApi, type StaffPage, type StaffRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { lookupsApi, type Lookups } from '../lib/operations-api';
import { USER_STATUS_LABELS } from '../lib/settings-api';
import { T, TEnum, useLabels } from '../lib/translation';

const SCREEN = 'staff.directory';

/**
 * Staff directory.
 *
 * Paged on the server. At five thousand records a client-side table is the kind of
 * thing that behaves during a demo and falls over on the first real month-end.
 */
export function StaffDirectoryPage(): ReactNode {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [scanState, setScanState] = useState<string | undefined>(undefined);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [counts, setCounts] = useState<StaffPage['counts'] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; reactivate?: boolean } | null>(
    null,
  );
  const [deactivating, setDeactivating] = useState<StaffRow | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await staffApi.list({
        page,
        pageSize,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(departmentId ? { departmentId: Number(departmentId) } : {}),
        ...(locationId ? { locationId: Number(locationId) } : {}),
        ...(scanState === 'missing' ? ({ biometrics: 'missing' } as const) : {}),
        ...(scanState === 'inactive' ? { active: false } : {}),
      });
      setRows(result.rows);
      setTotal(result.total);
      setCounts(result.counts);
      setGeneratedAt(new Date().toISOString());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, departmentId, locationId, scanState, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <PanelCard title={<T k="staff.title" />} subtitle={<T k="staff.subtitle" />}>
      <PanelSection
        title={
          <T k="staff.count" vars={{ count: new Intl.NumberFormat('ms-MY').format(total) }} />
        }
        subtitle={<T k="staff.section.subtitle" />}
        action={
          can(SCREEN, 'create') ? (
            <Button onClick={() => setEditing({ id: null })}>
              <Plus className="size-4" aria-hidden />
              <T k="staff.add" />
            </Button>
          ) : undefined
        }
      />

      {/*
        The most useful filter during rollout, promoted from a dropdown to a chip. Being
        unable to scan is a silent fault: the person is enrolled, nothing errors, and
        their attendance simply never arrives.
      */}
      <ChipBar
        active={scanState}
        onChange={(id) => {
          setScanState(id);
          setPage(1);
        }}
        /*
          From the server, and independent of which chip is selected. These were counted from
          the rows in hand, so with thirty per page the directory reported 28 staff without
          biometrics while the real figure was five thousand.
        */
        chips={[
          {
            id: 'missing',
            label: <T k="staff.chip.noBiometrics" />,
            count: counts?.missingBiometrics ?? 0,
            dot: 'bg-rose-500',
          },
          {
            id: 'inactive',
            label: <T k="app.status.inactive" />,
            count: counts?.inactive ?? 0,
            dot: 'bg-slate-400',
          },
        ]}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('staff.search')}
        dirty={
          search.length > 0 ||
          departmentId.length > 0 ||
          locationId.length > 0 ||
          scanState !== undefined
        }
        onReset={() => {
          setSearch('');
          setDepartmentId('');
          setLocationId('');
          setScanState(undefined);
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('staff.filter.allDepartments')}
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
          }}
          options={(lookups?.departments ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
        />
        <FacetSelect
          label={t('staff.filter.allLocations')}
          value={locationId}
          onChange={(value) => {
            setLocationId(value);
            setPage(1);
          }}
          options={(lookups?.locations ?? []).map((row) => ({
            value: String(row.id),
            label: row.name,
          }))}
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
        empty={<T k="staff.empty" />}
        columns={[
          { header: <T k="staff.column.employeeNo" />, width: 'w-28' },
          { header: <T k="staff.column.name" /> },
          { header: <T k="staff.column.department" />, width: 'w-40' },
          { header: <T k="staff.column.location" />, width: 'w-32' },
          { header: <T k="staff.column.biometrics" />, width: 'w-28' },
          { header: <T k="staff.column.account" />, width: 'w-44' },
          { header: <T k="panel.column.status" />, width: 'w-36' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <StaffRowView
            key={row.id}
            row={row}
            mayEdit={can(SCREEN, 'edit')}
            mayDeactivate={can(SCREEN, 'delete')}
            onOpen={() => void navigate(`/staf/${String(row.id)}`)}
            onEdit={() => setEditing({ id: row.id })}
            onReactivate={() => setEditing({ id: row.id, reactivate: true })}
            onDeactivate={() => setDeactivating(row)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={total}
        page={page}
        pageSize={pageSize}
        generatedAt={generatedAt}
        loading={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRefresh={() => void load()}
      />

      {editing !== null && (
        <StaffFormDialog
          staffId={editing.id}
          lookups={lookups}
          reactivate={editing.reactivate === true}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {deactivating !== null && (
        <StaffDeactivateDialog
          target={deactivating}
          onClose={() => setDeactivating(null)}
          onDone={async (message) => {
            setDeactivating(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function StaffRowView({
  row,
  mayEdit,
  mayDeactivate,
  onOpen,
  onEdit,
  onReactivate,
  onDeactivate,
}: {
  row: StaffRow;
  mayEdit: boolean;
  mayDeactivate: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onReactivate: () => void;
  onDeactivate: () => void;
}): ReactNode {
  const { t } = useLabels();
  const canScan = row.numOfFace > 0 || row.numOfFp > 0 || row.numOfCard > 0;
  const blocked = row.active && !canScan;

  return (
    <tr
      className={cn(
        'border-b border-slate-100 hover:bg-slate-50/70',
        blocked && 'bg-rose-50/40',
        !row.active && 'bg-slate-50/60',
      )}
    >
      <td className="px-5 py-2.5 font-mono text-xs text-slate-600">{row.employeeNo}</td>
      <td className="px-2 py-2.5">
        <span className={cn('font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}>
          {row.fullName}
        </span>
      </td>
      <td className="px-2 py-2.5 text-xs text-slate-600">{row.department?.name ?? '—'}</td>
      <td className="px-2 py-2.5 text-xs text-slate-600">{row.location?.name ?? '—'}</td>
      <td className="px-2 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <ScanFace
            className={cn('size-3.5', row.numOfFace > 0 ? 'text-emerald-600' : 'text-slate-300')}
            aria-label={t(
              row.numOfFace > 0 ? 'staff.biometric.face.present' : 'staff.biometric.face.absent',
            )}
          />
          <Fingerprint
            className={cn('size-3.5', row.numOfFp > 0 ? 'text-emerald-600' : 'text-slate-300')}
            aria-label={t(
              row.numOfFp > 0
                ? 'staff.biometric.fingerprint.present'
                : 'staff.biometric.fingerprint.absent',
            )}
          />
          <IdCard
            className={cn('size-3.5', row.numOfCard > 0 ? 'text-emerald-600' : 'text-slate-300')}
            aria-label={t(
              row.numOfCard > 0 ? 'staff.biometric.card.present' : 'staff.biometric.card.absent',
            )}
          />
          {/*
            The fourth credential. It was the only one of the four with no indicator, so a
            staff member with a PIN read as having nothing — which is what made the column
            disagree with the terminal's own screen.
          */}
          <KeyRound
            className={cn('size-3.5', row.hasDoorPin ? 'text-emerald-600' : 'text-slate-300')}
            aria-label={t(
              row.hasDoorPin ? 'staff.biometric.pin.present' : 'staff.biometric.pin.absent',
            )}
          />
        </span>
      </td>
      <td className="px-2 py-2.5 text-xs">
        {row.account === null ? (
          <span className="text-slate-400">
            <T k="staff.row.noAccount" />
          </span>
        ) : row.account.status === 'active' ? (
          <span className="block truncate text-slate-600" title={row.account.email}>
            {row.account.email}
          </span>
        ) : (
          // The account's state as words. The stored value (`suspended`) used to print here.
          <span className="text-amber-700" title={row.account.email}>
            <TEnum k={USER_STATUS_LABELS[row.account.status]} fallback={row.account.status} />
          </span>
        )}
      </td>
      <td className="px-2 py-2.5">
        {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
        {!row.active ? (
          <Badge tone="neutral" className="uppercase">
            <T k="app.status.inactive" />
          </Badge>
        ) : blocked ? (
          <Badge tone="danger" className="uppercase">
            <TriangleAlert className="size-3" aria-hidden />
            <T k="staff.status.cannotScan" />
          </Badge>
        ) : (
          <Badge tone="success" className="uppercase">
            <T k="app.status.active" />
          </Badge>
        )}
      </td>
      <td className="px-2 py-2.5 pr-4">
        <RowActions>
          {/*
            Opens the detail page rather than expanding in place. The expanded row could only
            render the nine fields this list query already held, so the address, job title,
            work pattern and per-terminal identifiers were fetched by the detail route and
            had nowhere to go — and one person's attendance, exceptions, leave and audit
            trail needed four other screens to reach.
          */}
          <RowAction
            icon={<Eye className="size-4" aria-hidden />}
            label={t('staff.row.open')}
            tone="view"
            onClick={onOpen}
          />
          {mayEdit && (
            <RowAction
              icon={<Pencil className="size-4" aria-hidden />}
              label={t('staff.row.edit')}
              tone="edit"
              onClick={onEdit}
            />
          )}
          {row.active
            ? mayDeactivate && (
                <RowAction
                  icon={<UserX className="size-4" aria-hidden />}
                  label={t('staff.row.deactivate')}
                  tone="danger"
                  onClick={onDeactivate}
                />
              )
            : mayEdit && (
                <RowAction
                  icon={<UserCheck className="size-4" aria-hidden />}
                  label={t('staff.row.reactivate')}
                  tone="success"
                  onClick={onReactivate}
                />
              )}
        </RowActions>
      </td>
    </tr>
  );
}

