import { Building2, MapPin, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  Detail,
  DetailGrid,
  ExpandButton,
  FilterRow,
  FormGrid,
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
import { Button, Field } from '../components/ui';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { T, useLabels } from '../lib/translation';

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

export function OrgPage(): ReactNode {
  const [tab, setTab] = useState('departments');
  const [counts, setCounts] = useState<{ departments: number; locations: number } | null>(null);
  const { t } = useLabels();

  const reloadCounts = useCallback(() => {
    void Promise.all([
      api.get<Department[]>('/api/departments'),
      api.get<Location[]>('/api/locations'),
    ])
      .then(([departments, locations]) =>
        setCounts({ departments: departments.length, locations: locations.length }),
      )
      .catch(() => setCounts(null));
  }, []);

  useEffect(reloadCounts, [reloadCounts]);

  return (
    <PanelCard title={<T k="org.title" />} subtitle={<T k="org.subtitle" />}>
      <PanelTabs
        label={t('org.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'departments',
            label: <T k="org.tab.departments" />,
            labelText: t('org.tab.departments'),
            icon: <Building2 className="size-4" aria-hidden />,
            count: counts?.departments,
          },
          {
            id: 'locations',
            label: <T k="org.tab.locations" />,
            labelText: t('org.tab.locations'),
            icon: <MapPin className="size-4" aria-hidden />,
            count: counts?.locations,
          },
        ]}
      />

      {tab === 'departments' ? (
        <DepartmentsPanel onChanged={reloadCounts} />
      ) : (
        <LocationsPanel onChanged={reloadCounts} />
      )}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

function DepartmentsPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const [rows, setRows] = useState<Department[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [confirming, setConfirming] = useState<Department | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<Department[]>('/api/departments'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('org.dept.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Department): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/api/departments/${String(row.id)}`);
      setNotice(t('org.dept.removed', { name: row.name }));
      await load();
      onChanged();
    } catch (cause) {
      // The server refuses while staff or sub-departments are still attached, and says
      // how many. Detaching a thousand people as a side effect of a delete click is not
      // something the operator asked for.
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  }

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      needle.length === 0 ||
      row.name.toLowerCase().includes(needle) ||
      (row.code ?? '').toLowerCase().includes(needle),
  );
  const staffTotal = rows.reduce((running, row) => running + row.staffCount, 0);

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
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            <T k="org.dept.add" />
          </Button>
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('org.dept.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        loading={loading}
        rowCount={filtered.length}
        empty={<T k="org.dept.empty" />}
        columns={[
          { header: <T k="org.dept.column.name" /> },
          { header: <T k="org.dept.column.code" />, width: 'w-28' },
          { header: <T k="org.dept.column.parent" />, width: 'w-44' },
          { header: <T k="org.dept.column.children" />, width: 'w-32' },
          { header: <T k="org.dept.column.staff" />, width: 'w-24' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {filtered.map((row) => {
          const expanded = open === row.id;
          const locked = row.staffCount > 0 || row.childCount > 0;

          return (
            <>
              <tr
                key={row.id}
                className={cn(
                  'border-b border-slate-100',
                  expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                )}
              >
                <td className="px-5 py-2.5 font-medium text-slate-800">{row.name}</td>
                <td className="px-2 py-2.5 font-mono text-xs text-slate-600">{row.code ?? '—'}</td>
                <td className="px-2 py-2.5 text-xs text-slate-600">{row.parent?.name ?? '—'}</td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-slate-600">
                  {row.childCount === 0 ? <span className="text-slate-300">—</span> : row.childCount}
                </td>
                <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">{row.staffCount}</td>
                <td className="px-2 py-2.5 pr-4">
                  <RowActions>
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={t('org.dept.row.edit')}
                      tone="edit"
                      onClick={() => setEditing(row)}
                    />
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
                      onClick={() => setConfirming(row)}
                    />
                    <ExpandButton
                      expanded={expanded}
                      onClick={() => setOpen(expanded ? null : row.id)}
                      label={t('org.dept.row.expand')}
                    />
                  </RowActions>
                </td>
              </tr>

              {expanded && (
                <tr key={`${String(row.id)}-detail`} className="border-b border-slate-200 bg-slate-50">
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
            </>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={filtered.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => {
          void load();
          onChanged();
        }}
      />

      {editing !== null && (
        <DepartmentDialog
          target={editing === 'new' ? null : editing}
          options={rows}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
            onChanged();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="org.dept.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('org.dept.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T k="org.dept.remove.body" />
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
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="org.dept.column.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <Field
          label={<T k="org.dept.column.code" />}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />

        <div>
          <label htmlFor="dept-parent" className="block text-sm font-medium text-slate-700">
            <T k="org.dept.detail.parent" />
          </label>
          <select
            id="dept-parent"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">{t('org.dept.dialog.parent.none')}</option>
            {options
              // A department cannot be its own parent. The server also rejects longer
              // cycles, but hiding the obvious case avoids a pointless error.
              .filter((option) => option.id !== target?.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </select>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

function LocationsPanel({ onChanged }: { onChanged: () => void }): ReactNode {
  const [rows, setRows] = useState<Location[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const [confirming, setConfirming] = useState<Location | null>(null);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<Location[]>('/api/locations'));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('org.loc.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Location): Promise<void> {
    setConfirming(null);
    setError(null);
    setNotice(null);
    try {
      await api.delete(`/api/locations/${String(row.id)}`);
      setNotice(t('org.loc.removed', { name: row.name }));
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
    }
  }

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

  return (
    <>
      <PanelSection
        title={<T k="org.loc.count" vars={{ count: rows.length }} />}
        subtitle={<T k="org.loc.subtitle" />}
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            <T k="org.loc.add" />
          </Button>
        }
      />

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('org.loc.search')}
        dirty={search.length > 0}
        onReset={() => setSearch('')}
      />

      <PanelBody className="space-y-3 pb-0">
        <Feedback error={error} notice={notice} />
        {missingCoords > 0 && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="org.loc.missingCoords" vars={{ count: missingCoords }} />
          </PanelNote>
        )}
      </PanelBody>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="org.loc.empty" />}
          columns={[
            { header: <T k="org.dept.column.name" /> },
            { header: <T k="org.loc.column.coords" />, width: 'w-48' },
            { header: <T k="org.loc.column.radius" />, width: 'w-24' },
            { header: <T k="org.dept.column.staff" />, width: 'w-20' },
            { header: <T k="org.loc.column.devices" />, width: 'w-24' },
            { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const expanded = open === row.id;
            const locked = row.staffCount > 0 || row.deviceCount > 0;
            const noCoords = row.latitude === null || row.longitude === null;

            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                    noCoords && !expanded && 'bg-amber-50/40',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <span className="block font-medium text-slate-800">{row.name}</span>
                    {row.address !== null && row.address.length > 0 && (
                      <span className="block truncate text-[11px] text-slate-400">
                        {row.address}
                      </span>
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
                  <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-slate-600">
                    {row.geofenceRadiusM} m
                  </td>
                  <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">
                    {row.staffCount}
                  </td>
                  <td className="px-2 py-2.5 text-xs tabular-nums text-slate-700">
                    {row.deviceCount}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      <RowAction
                        icon={<Pencil className="size-4" aria-hidden />}
                        label={t('org.loc.row.edit')}
                        tone="edit"
                        onClick={() => setEditing(row)}
                      />
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
                        onClick={() => setConfirming(row)}
                      />
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('org.loc.row.expand')}
                      />
                    </RowActions>
                  </td>
                </tr>

                {expanded && (
                  <tr
                    key={`${String(row.id)}-detail`}
                    className="border-b border-slate-200 bg-slate-50"
                  >
                    <td colSpan={6} className="px-5 py-3">
                      <DetailGrid>
                        <Detail label={<T k="org.dept.column.name" />} value={row.name} />
                        <Detail
                          label={<T k="org.loc.detail.address" />}
                          value={row.address ?? '—'}
                        />
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
                        <Detail
                          label={<T k="org.loc.detail.id" />}
                          value={String(row.id)}
                          mono
                        />
                      </DetailGrid>

                      {noCoords && (
                        <PanelNote tone="warn" className="mt-3">
                          <T k="org.loc.detail.noCoords" />
                        </PanelNote>
                      )}
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
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => {
          void load();
          onChanged();
        }}
      />

      {editing !== null && (
        <LocationDialog
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
            onChanged();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="org.loc.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('org.loc.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <T k="org.loc.remove.body" />
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
    </>
  );
}

/**
 * Location editor.
 *
 * Coordinates and radius are collected here even though app check-in is not built yet,
 * because they describe the place rather than the app. Gathering them while somebody is
 * already editing these records avoids a second pass over every site.
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
    <Dialog title={<T k={titleKey} />} titleText={t(titleKey)} onClose={onClose}>
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="org.dept.column.name" />}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <Field
          label={<T k="org.loc.detail.address" />}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />

        <FormGrid>
          {/* Coordinate placeholders are sample numbers, not words — the same in
              every language. */}
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
        </FormGrid>

        <Field
          label={<T k="org.loc.dialog.radius" />}
          inputMode="numeric"
          value={radius}
          onChange={(event) => setRadius(event.target.value.replace(/\D/g, ''))}
          hint={<T k="org.loc.dialog.radius.hint" />}
        />

        <PanelNote icon={<MapPin className="size-3.5" aria-hidden />}>
          <T k="org.loc.dialog.note" />
        </PanelNote>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
        />
      </div>
    </Dialog>
  );
}
