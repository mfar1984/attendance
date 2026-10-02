import { Building2, MapPin, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  Detail,
  DetailGrid,
  ExpandButton,
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
import { Button, Field, SelectField, TextArea } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { T, useLabels } from '../lib/translation';

const DEPARTMENTS = 'staff.departments';
const LOCATIONS = 'staff.locations';

interface Department {
  id: number;
  name: string;
  code: string | null;
  parentId: number | null;
  parent: { id: number; name: string } | null;
  staffCount: number;
  childCount: number;
}

interface Location {
  id: number;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
  staffCount: number;
  deviceCount: number;
}

/** One list, loaded once and handed to its tab, so the tab count and the table agree. */
interface ListState<Row> {
  rows: Row[];
  loading: boolean;
  error: string | null;
  loadedAt: string | null;
}

const EMPTY = { rows: [], loading: true, error: null, loadedAt: null };

/**
 * Departments and locations.
 *
 * Two screens behind one route, each with its own grant. Both lists were fetched twice — once per
 * tab and once more for the tab counts — and the counts went through `Promise.all`, so somebody
 * allowed departments but not locations saw no count on either tab and a 403 on the second.
 */
export function OrgPage(): ReactNode {
  const { can } = useAuth();
  const mayDepartments = can(DEPARTMENTS, 'view');
  const mayLocations = can(LOCATIONS, 'view');
  const [tab, setTab] = useState(mayDepartments ? 'departments' : 'locations');
  const [departments, setDepartments] = useState<ListState<Department>>(EMPTY);
  const [locations, setLocations] = useState<ListState<Location>>(EMPTY);
  const { t } = useLabels();

  const loadDepartments = useCallback(async () => {
    if (!mayDepartments) return;
    setDepartments((current) => ({ ...current, loading: true }));
    try {
      const rows = await api.get<Department[]>('/api/departments');
      setDepartments({ rows, loading: false, error: null, loadedAt: new Date().toISOString() });
    } catch (cause) {
      setDepartments((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : t('org.dept.error.load'),
      }));
    }
  }, [mayDepartments, t]);

  const loadLocations = useCallback(async () => {
    if (!mayLocations) return;
    setLocations((current) => ({ ...current, loading: true }));
    try {
      const rows = await api.get<Location[]>('/api/locations');
      setLocations({ rows, loading: false, error: null, loadedAt: new Date().toISOString() });
    } catch (cause) {
      setLocations((current) => ({
        ...current,
        loading: false,
        error: cause instanceof Error ? cause.message : t('org.loc.error.load'),
      }));
    }
  }, [mayLocations, t]);

  useEffect(() => {
    void loadDepartments();
    void loadLocations();
  }, [loadDepartments, loadLocations]);

  // Tabs only when there are two subjects to switch between.
  const tabs = [
    ...(mayDepartments
      ? [
          {
            id: 'departments',
            label: <T k="org.tab.departments" />,
            labelText: t('org.tab.departments'),
            icon: <Building2 className="size-4" aria-hidden />,
            count: departments.rows.length,
          },
        ]
      : []),
    ...(mayLocations
      ? [
          {
            id: 'locations',
            label: <T k="org.tab.locations" />,
            labelText: t('org.tab.locations'),
            icon: <MapPin className="size-4" aria-hidden />,
            count: locations.rows.length,
          },
        ]
      : []),
  ];

  return (
    <PanelCard title={<T k="org.title" />} subtitle={<T k="org.subtitle" />}>
      {tabs.length > 1 && (
        <PanelTabs label={t('org.tabs.aria')} active={tab} onChange={setTab} tabs={tabs} />
      )}

      {tab === 'departments' && mayDepartments && (
        <DepartmentsPanel list={departments} onReload={loadDepartments} />
      )}
      {tab === 'locations' && mayLocations && (
        <LocationsPanel list={locations} onReload={loadLocations} />
      )}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

function DepartmentsPanel({
  list,
  onReload,
}: {
  list: ListState<Department>;
  onReload: () => Promise<void>;
}): ReactNode {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [removing, setRemoving] = useState<Department | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayEdit = can(DEPARTMENTS, 'edit');
  const mayRemove = can(DEPARTMENTS, 'delete');

  const { rows, loading } = list;
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      (row.code ?? '').toLowerCase().includes(needle),
  );
  const staffTotal = rows.reduce((running, row) => running + row.staffCount, 0);
  const shownError = error ?? list.error;

  const done = async (message: string): Promise<void> => {
    setEditing(null);
    setRemoving(null);
    setError(null);
    setNotice(message);
    await onReload();
  };

  return (
    <>
      <PanelSection
        title={<T k="org.dept.count" vars={{ count: rows.length }} />}
        subtitle={
          <T
            k="org.dept.subtitle"
            vars={{ staff: new Intl.NumberFormat('ms-MY').format(staffTotal) }}
          />
        }
        action={
          can(DEPARTMENTS, 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="org.dept.add" />
            </Button>
          ) : undefined
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('org.dept.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(shownError !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={shownError} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="org.dept.empty" />}
        columns={[
          { header: <T k="org.dept.column.name" /> },
          { header: <T k="org.dept.column.code" />, width: 'w-28' },
          { header: <T k="org.dept.column.parent" />, width: 'w-48' },
          { header: <T k="org.dept.column.children" />, width: 'w-28', align: 'right' },
          { header: <T k="org.dept.column.staff" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          const locked = row.staffCount > 0 || row.childCount > 0;

          return (
            <Fragment key={row.id}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                )}
              >
                <td className="px-5 py-2.5 font-medium text-slate-800">{row.name}</td>
                <td className="px-2 py-2.5 font-mono text-xs text-slate-600">{row.code ?? '—'}</td>
                <td className="px-2 py-2.5 text-xs text-slate-600">{row.parent?.name ?? '—'}</td>
                <td className="px-2 py-2.5 text-right text-xs text-slate-600 tabular-nums">
                  {row.childCount === 0 ? <span className="text-slate-300">—</span> : row.childCount}
                </td>
                <td className="px-2 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                  {row.staffCount}
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    {mayEdit && (
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('org.dept.row.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
                    )}
                    {mayRemove && (
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          locked
                            ? t('org.dept.row.locked', {
                                staff: row.staffCount,
                                children: row.childCount,
                              })
                            : t('org.dept.row.remove')
                        }
                        tone="danger"
                        disabled={locked}
                        onClick={() => setRemoving(row)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('org.dept.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td colSpan={6} className="px-5 py-3">
                    <DetailGrid>
                      <Detail label={<T k="org.dept.column.name" />} value={row.name} />
                      <Detail
                        label={<T k="org.dept.column.code" />}
                        value={row.code ?? '—'}
                        mono
                      />
                      <Detail
                        label={<T k="org.dept.detail.parent" />}
                        value={row.parent?.name ?? <T k="org.dept.detail.topLevel" />}
                      />
                      <Detail
                        label={<T k="org.dept.column.children" />}
                        value={String(row.childCount)}
                      />
                      <Detail
                        label={<T k="org.dept.detail.staff" />}
                        value={String(row.staffCount)}
                      />
                      <Detail label={<T k="org.dept.detail.id" />} value={String(row.id)} mono />
                    </DetailGrid>

                    {locked && (
                      <PanelNote className="mt-3">
                        <T
                          k="org.dept.detail.locked"
                          vars={{ staff: row.staffCount, children: row.childCount }}
                        />
                      </PanelNote>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={list.loadedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void onReload()}
      />

      {editing !== null && (
        <DepartmentDialog
          target={editing === 'new' ? null : editing}
          options={rows}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="org.dept.remove.title" vars={{ name: removing.name }} />}
          titleText={t('org.dept.remove.title', { name: removing.name })}
          description={<T k="org.dept.remove.body" />}
          onConfirm={async () => {
            await api.delete(`/api/departments/${String(removing.id)}`);
            await done(t('org.dept.removed', { name: removing.name }));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

function DepartmentDialog({
  target,
  options,
  onClose,
  onSaved,
}: {
  target: Department | null;
  options: Department[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(target?.name ?? '');
  const [code, setCode] = useState(target?.code ?? '');
  const [parentId, setParentId] = useState<string>(
    target?.parentId === null || target?.parentId === undefined ? '' : String(target.parentId),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const payload = {
      name: name.trim(),
      code: code.trim(),
      parentId: parentId === '' ? null : Number(parentId),
    };

    try {
      if (target) {
        await api.patch(`/api/departments/${String(target.id)}`, payload);
      } else {
        await api.post('/api/departments', payload);
      }
      await onSaved(t('org.dept.saved', { name: payload.name }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  }

  const titleKey = target ? 'org.dept.dialog.edit' : 'org.dept.dialog.create';

  return (
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} width="lg" onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        {/* Identity first: the short code somebody types, then the name they read. */}
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <Field
            label={<T k="org.dept.column.code" />}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Field
            label={<T k="org.dept.column.name" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>

        {/* The last block before the footer, so it carries the `pb-2`. "None" is a real choice
            here — a top-level department — so the empty option is written out, not a facet's. */}
        <div className="pb-2">
          <SelectField
            label={<T k="org.dept.detail.parent" />}
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">{t('org.dept.dialog.parent.none')}</option>
            {options
              // A department cannot be its own parent. The server also rejects longer cycles, but
              // hiding the obvious case avoids a pointless error.
              .filter((option) => option.id !== target?.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </SelectField>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
          submitLabel={<T k={target ? 'dialog.save' : 'org.dept.dialog.create'} />}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

function LocationsPanel({
  list,
  onReload,
}: {
  list: ListState<Location>;
  onReload: () => Promise<void>;
}): ReactNode {
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const [removing, setRemoving] = useState<Location | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();
  const mayEdit = can(LOCATIONS, 'edit');
  const mayRemove = can(LOCATIONS, 'delete');

  const { rows, loading } = list;
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      (row.address ?? '').toLowerCase().includes(needle),
  );
  const missingCoords = rows.filter(
    (row) => row.latitude === null || row.longitude === null,
  ).length;
  const shownError = error ?? list.error;

  const done = async (message: string): Promise<void> => {
    setEditing(null);
    setRemoving(null);
    setError(null);
    setNotice(message);
    await onReload();
  };

  return (
    <>
      <PanelSection
        title={<T k="org.loc.count" vars={{ count: rows.length }} />}
        subtitle={<T k="org.loc.subtitle" />}
        action={
          can(LOCATIONS, 'create') ? (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              <T k="org.loc.add" />
            </Button>
          ) : undefined
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('org.loc.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(shownError !== null || notice !== null || missingCoords > 0) && (
        <PanelBody className="space-y-2 pb-0">
          <Feedback error={shownError} notice={notice} />
          {missingCoords > 0 && (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="org.loc.missingCoords" vars={{ count: missingCoords }} />
            </PanelNote>
          )}
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="org.loc.empty" />}
        columns={[
          { header: <T k="org.dept.column.name" /> },
          { header: <T k="org.loc.column.coords" />, width: 'w-48' },
          { header: <T k="org.loc.column.radius" />, width: 'w-24', align: 'right' },
          { header: <T k="org.dept.column.staff" />, width: 'w-20', align: 'right' },
          { header: <T k="org.loc.column.devices" />, width: 'w-24', align: 'right' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          const locked = row.staffCount > 0 || row.deviceCount > 0;
          const noCoords = row.latitude === null || row.longitude === null;

          return (
            <Fragment key={row.id}>
              <tr
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                  noCoords && !expanded && 'bg-amber-50/40',
                )}
              >
                <td className="px-5 py-2.5">
                  <span className="block font-medium text-slate-800">{row.name}</span>
                  {row.address !== null && row.address.length > 0 && (
                    <span className="block truncate text-[11px] text-slate-400">{row.address}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 font-mono text-xs">
                  {noCoords ? (
                    <span className="text-amber-700">
                      <T k="org.loc.coords.unset" />
                    </span>
                  ) : (
                    <span className="text-slate-600">
                      {row.latitude}, {row.longitude}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums">
                  {row.geofenceRadiusM} m
                </td>
                <td className="px-2 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                  {row.staffCount}
                </td>
                <td className="px-2 py-2.5 text-right text-xs text-slate-700 tabular-nums">
                  {row.deviceCount}
                </td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    {mayEdit && (
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('org.loc.row.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
                    )}
                    {mayRemove && (
                      <RowAction
                        icon={<Trash2 className="size-4" aria-hidden />}
                        label={
                          locked
                            ? t('org.loc.row.locked', {
                                staff: row.staffCount,
                                devices: row.deviceCount,
                              })
                            : t('org.loc.row.remove')
                        }
                        tone="danger"
                        disabled={locked}
                        onClick={() => setRemoving(row)}
                      />
                    )}
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('org.loc.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr className="border-b border-slate-200 bg-slate-50">
                  <td colSpan={6} className="px-5 py-3">
                    <DetailGrid>
                      <Detail label={<T k="org.dept.column.name" />} value={row.name} />
                      <Detail label={<T k="org.loc.detail.address" />} value={row.address ?? '—'} />
                      <Detail
                        label={<T k="org.loc.detail.latitude" />}
                        value={row.latitude === null ? '—' : String(row.latitude)}
                        mono
                      />
                      <Detail
                        label={<T k="org.loc.detail.longitude" />}
                        value={row.longitude === null ? '—' : String(row.longitude)}
                        mono
                      />
                      <Detail
                        label={<T k="org.loc.detail.radius" />}
                        value={`${String(row.geofenceRadiusM)} m`}
                      />
                      <Detail
                        label={<T k="org.dept.detail.staff" />}
                        value={String(row.staffCount)}
                      />
                      <Detail
                        label={<T k="org.loc.detail.devices" />}
                        value={String(row.deviceCount)}
                      />
                      <Detail label={<T k="org.loc.detail.id" />} value={String(row.id)} mono />
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
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        generatedAt={list.loadedAt}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void onReload()}
      />

      {editing !== null && (
        <LocationDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}

      {removing !== null && (
        <RemoveDialog
          title={<T k="org.loc.remove.title" vars={{ name: removing.name }} />}
          titleText={t('org.loc.remove.title', { name: removing.name })}
          description={<T k="org.loc.remove.body" />}
          onConfirm={async () => {
            await api.delete(`/api/locations/${String(removing.id)}`);
            await done(t('org.loc.removed', { name: removing.name }));
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
}

/**
 * Location editor.
 *
 * Coordinates and radius are collected here even though app check-in is not built yet, because
 * they describe the place rather than the app. Gathering them while somebody is already editing
 * these records avoids a second pass over every site.
 */
function LocationDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Location | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(target?.name ?? '');
  const [address, setAddress] = useState(target?.address ?? '');
  const [latitude, setLatitude] = useState(
    target?.latitude === null ? '' : String(target?.latitude ?? ''),
  );
  const [longitude, setLongitude] = useState(
    target?.longitude === null ? '' : String(target?.longitude ?? ''),
  );
  const [radius, setRadius] = useState(String(target?.geofenceRadiusM ?? 200));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    const payload = {
      name: name.trim(),
      address: address.trim(),
      latitude: latitude.trim() === '' ? null : Number(latitude),
      longitude: longitude.trim() === '' ? null : Number(longitude),
      geofenceRadiusM: Number(radius),
    };

    try {
      if (target) {
        await api.patch(`/api/locations/${String(target.id)}`, payload);
      } else {
        await api.post('/api/locations', payload);
      }
      await onSaved(t('org.loc.saved', { name: payload.name }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
      setBusy(false);
    }
  }

  const titleKey = target ? 'org.loc.dialog.edit' : 'org.loc.dialog.create';

  return (
    <Dialog
      title={<T k={titleKey} />}
      titleText={t(titleKey)}
      // The caveat about leaving the coordinates blank, read before the form rather than after it.
      description={<T k="org.loc.dialog.note" />}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="org.dept.column.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <TextArea
          label={<T k="org.loc.detail.address" />}
          rows={2}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />

        {/* The last block before the footer, so it carries the `pb-2`. `items-start` so the radius
            hint does not stretch the coordinate fields beside it. */}
        <div className="grid items-start gap-4 pb-2 sm:grid-cols-3">
          {/* Coordinate placeholders are sample numbers, not words — the same in every language. */}
          <Field
            label={<T k="org.loc.detail.latitude" />}
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
            placeholder="2.2870"
          />
          <Field
            label={<T k="org.loc.detail.longitude" />}
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
            placeholder="111.8305"
          />
          <Field
            label={<T k="org.loc.dialog.radius" />}
            inputMode="numeric"
            value={radius}
            onChange={(event) => setRadius(event.target.value.replace(/\D/g, ''))}
            hint={<T k="org.loc.dialog.radius.hint" />}
          />
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
          submitLabel={<T k={target ? 'dialog.save' : 'org.loc.dialog.create'} />}
        />
      </div>
    </Dialog>
  );
}
