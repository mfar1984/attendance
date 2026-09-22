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

import { Dialog, Feedback } from '../components/Dialog';
import {
  ChipBar,
  FacetSelect,
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
import { StaffFormDialog } from '../components/StaffFormDialog';
import { Button } from '../components/ui';
import { staffApi, type StaffPage, type StaffRow } from '../lib/api';
import { cn } from '../lib/cn';
import { lookupsApi, type Lookups } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

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
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [confirming, setConfirming] = useState<StaffRow | null>(null);
  const { t } = useLabels();
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

  async function deactivate(staff: StaffRow): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      const result = await staffApi.deactivate(staff.id);
      const failed = result.removal.filter((row) => !row.ok);
      setNotice(
        failed.length === 0
          ? t('staff.deactivate.done', {
              name: staff.fullName,
              count: result.removal.length,
            })
          : t('staff.deactivate.partial', {
              name: staff.fullName,
              count: failed.length,
              devices: failed.map((row) => row.deviceName).join(', '),
            }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.deactivate.error'));
    }
  }



  return (
    <PanelCard title={<T k="staff.title" />} subtitle={<T k="staff.subtitle" />}>
      <PanelSection
        title={
          <T k="staff.count" vars={{ count: new Intl.NumberFormat('ms-MY').format(total) }} />
        }
        subtitle={<T k="staff.section.subtitle" />}
        action={
          <Button onClick={() => setEditing({ id: null })}>
            <Plus className="size-4" aria-hidden />
            <T k="staff.add" />
          </Button>
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
            onOpen={() => void navigate(`/staf/${String(row.id)}`)}
            onEdit={() => setEditing({ id: row.id })}
            onDeactivate={() => setConfirming(row)}
          />
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={total}
        page={page}
        pageSize={pageSize}
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
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="staff.deactivate.title" vars={{ name: confirming.fullName }} />}
          titleText={t('staff.deactivate.title', { name: confirming.fullName })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T k="staff.deactivate.body" />
            </p>
            <PanelNote tone="success">
              <T
                k="staff.deactivate.note"
                vars={{
                  emphasis: (
                    <strong>
                      <T k="staff.deactivate.kept" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void deactivate(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="staff.deactivate.submit" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </PanelCard>
  );
}

function StaffRowView({
  row,
  onOpen,
  onEdit,
  onDeactivate,
}: {
  row: StaffRow;
  onOpen: () => void;
  onEdit: () => void;
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
        <td className="px-5 py-2 font-mono text-xs text-slate-600">{row.employeeNo}</td>
        <td className="px-2 py-2">
          <span className={cn('font-medium', row.active ? 'text-slate-800' : 'text-slate-400')}>
            {row.fullName}
          </span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.department?.name ?? '—'}</td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.location?.name ?? '—'}</td>
        <td className="px-2 py-2">
          <span className="inline-flex items-center gap-1.5">
            <ScanFace
              className={cn('size-3.5', row.numOfFace > 0 ? 'text-emerald-600' : 'text-slate-300')}
              aria-label={t(
                row.numOfFace > 0
                  ? 'staff.biometric.face.present'
                  : 'staff.biometric.face.absent',
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
                row.numOfCard > 0
                  ? 'staff.biometric.card.present'
                  : 'staff.biometric.card.absent',
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
        <td className="px-2 py-2 text-xs">
          {row.account === null ? (
            <span className="text-slate-400">
              <T k="staff.row.noAccount" />
            </span>
          ) : (
            <span className="block truncate text-slate-600" title={row.account.email}>
              {row.account.status === 'active' ? row.account.email : row.account.status}
            </span>
          )}
        </td>
        <td className="px-2 py-2">
          {/* Uppercased in CSS: a translated word cannot be upper-cased safely in every
              language. */}
          {!row.active ? (
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
              <T k="app.status.inactive" />
            </span>
          ) : blocked ? (
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-rose-700 uppercase">
              <TriangleAlert className="size-3" aria-hidden />
              <T k="staff.status.cannotScan" />
            </span>
          ) : (
            <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
              <T k="app.status.active" />
            </span>
          )}
        </td>
      <td className="px-2 py-2 pr-4">
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
          <RowAction
            icon={<Pencil className="size-4" aria-hidden />}
            label={t('staff.row.edit')}
            tone="edit"
            onClick={onEdit}
          />
          {row.active ? (
            <RowAction
              icon={<UserX className="size-4" aria-hidden />}
              label={t('staff.row.deactivate')}
              tone="danger"
              onClick={onDeactivate}
            />
          ) : (
            <RowAction
              icon={<UserCheck className="size-4" aria-hidden />}
              label={t('staff.row.reactivate')}
              tone="success"
              onClick={onEdit}
            />
          )}
        </RowActions>
      </td>
    </tr>
  );
}
