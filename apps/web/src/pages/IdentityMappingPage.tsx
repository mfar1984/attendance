import {
  CircleCheck,
  Download,
  Fingerprint,
  IdCard,
  Link2,
  ScanFace,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useOutletContext } from 'react-router';

import { Dialog, Feedback } from '../components/Dialog';
import type { ShellContext } from '../components/layout/AppShell';
import {
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
import { Badge, Button } from '../components/ui';
import {
  identityApi,
  type StaffCandidate,
  type UnconfirmedMapping,
  type UnmappedUser,
} from '../lib/api';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/operations-api';
import { T, useLabels } from '../lib/translation';

/**
 * Resolves which person each terminal identifier belongs to.
 *
 * A terminal never sends us a face. It matches biometrics locally and reports only its
 * own `employeeNo`, and that number is local to the unit: the same person is routinely
 * 1001 on one door and 680 on another. This mapping is the sole link between a scan and
 * a person, and a wrong row credits one employee's attendance to another with nothing
 * raising an error.
 *
 * Which is why nothing here resolves automatically on a name. Names are not unique at
 * this headcount, and the terminal's name field is editable at the keypad.
 */
export function IdentityMappingPage(): ReactNode {
  const { data } = useOutletContext<ShellContext>();

  const [tab, setTab] = useState('unmapped');
  const [unmapped, setUnmapped] = useState<UnmappedUser[]>([]);
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useLabels();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, review] = await Promise.all([
        identityApi.unmapped(),
        identityApi.unconfirmed(),
      ]);
      setUnmapped(pending);
      setUnconfirmed(review);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function importFrom(deviceId: number, deviceLabel: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await identityApi.importUsers(deviceId);
      setNotice(
        t('mapping.import.done', {
          device: deviceLabel,
          users: result.deviceUsers,
          auto: result.autoMapped,
          existing: result.alreadyMapped,
          review: result.needsReview,
        }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.import.error'));
    } finally {
      setBusy(false);
    }
  }

  const devices = data?.devices ?? [];

  return (
    <PanelCard title={<T k="mapping.title" />} subtitle={<T k="mapping.subtitle" />}>
      <PanelTabs
        label={t('mapping.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'unmapped',
            label: <T k="mapping.tab.unmapped" />,
            labelText: t('mapping.tab.unmapped'),
            icon: <TriangleAlert className="size-4" aria-hidden />,
            count: unmapped.length,
          },
          {
            id: 'unconfirmed',
            label: <T k="mapping.tab.unconfirmed" />,
            labelText: t('mapping.tab.unconfirmed'),
            icon: <Link2 className="size-4" aria-hidden />,
            count: unconfirmed.length,
          },
          {
            id: 'import',
            label: <T k="mapping.tab.import" />,
            labelText: t('mapping.tab.import'),
            icon: <Download className="size-4" aria-hidden />,
          },
        ]}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      {tab === 'unmapped' && (
        <UnmappedPanel
          rows={unmapped}
          loading={loading}
          onReload={() => void load()}
          onMapped={async (message) => {
            setNotice(message);
            await load();
          }}
        />
      )}

      {tab === 'unconfirmed' && (
        <UnconfirmedPanel
          rows={unconfirmed}
          loading={loading}
          busy={busy}
          onReload={() => void load()}
          onConfirmed={async (message) => {
            setNotice(message);
            await load();
          }}
          onError={setError}
          setBusy={setBusy}
        />
      )}

      {tab === 'import' && (
        <>
          <PanelSection
            title={<T k="mapping.import.title" />}
            subtitle={<T k="mapping.import.subtitle" />}
          />
          <PanelBody className="space-y-4">
            <PanelNote>
              <T
                k="mapping.import.note"
                vars={{
                  emphasis: (
                    <strong className="font-medium">
                      <T k="mapping.import.unconfirmed" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>

            {devices.length === 0 ? (
              <p className="text-sm text-slate-500">
                <T k="mapping.import.noDevices" />
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {devices.map((device) => (
                  <Button
                    key={device.id}
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void importFrom(device.id, device.name)}
                  >
                    <Download className="size-4" aria-hidden />
                    {device.name}
                  </Button>
                ))}
              </div>
            )}
          </PanelBody>
        </>
      )}
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------
// Unmapped
// ---------------------------------------------------------------------------

function UnmappedPanel({
  rows,
  loading,
  onReload,
  onMapped,
}: {
  rows: UnmappedUser[];
  loading: boolean;
  onReload: () => void;
  onMapped: (message: string) => Promise<void>;
}): ReactNode {
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<UnmappedUser | null>(null);
  const { t } = useLabels();

  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (deviceFilter.length > 0 && String(row.deviceId) !== deviceFilter) return false;
    return (
      needle.length === 0 ||
      row.deviceEmployeeNo.toLowerCase().includes(needle) ||
      (row.deviceName ?? '').toLowerCase().includes(needle)
    );
  });

  const losing = rows.filter((row) => row.scanCount > 0);
  const lostScans = losing.reduce((running, row) => running + row.scanCount, 0);

  const deviceOptions = [...new Map(rows.map((row) => [row.deviceId, row.device.name])).entries()];

  return (
    <>
      <PanelSection
        title={
          rows.length === 0 ? (
            <T k="mapping.unmapped.none" />
          ) : (
            <T k="mapping.unmapped.count" vars={{ count: rows.length }} />
          )
        }
        subtitle={<T k="mapping.unmapped.subtitle" />}
      />

      {lostScans > 0 && (
        <PanelBody className="pb-0">
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T
              k="mapping.unmapped.lostScans"
              vars={{ scans: lostScans, ids: losing.length }}
            />
          </PanelNote>
        </PanelBody>
      )}

      <FilterRow
        search={search}
        onSearch={setSearch}
        placeholder={t('mapping.unmapped.search')}
        dirty={search.length > 0 || deviceFilter.length > 0}
        onReset={() => {
          setSearch('');
          setDeviceFilter('');
        }}
      >
        <FacetSelect
          label={t('rawlog.filter.allDevices')}
          value={deviceFilter}
          onChange={setDeviceFilter}
          options={deviceOptions.map(([id, name]) => ({ value: String(id), label: name }))}
        />
      </FilterRow>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={filtered.length}
          empty={<T k="mapping.unmapped.empty" />}
          columns={[
            { header: <T k="mapping.column.terminal" />, width: 'w-40' },
            { header: <T k="mapping.column.terminalId" />, width: 'w-32' },
            { header: <T k="mapping.column.terminalName" /> },
            { header: <T k="mapping.column.biometrics" />, width: 'w-28' },
            { header: <T k="mapping.column.lostScans" />, width: 'w-32' },
            { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
          ]}
        >
          {filtered.map((row) => {
            const expanded = open === row.id;
            return (
              <>
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-slate-100',
                    expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
                    row.scanCount > 0 && !expanded && 'bg-rose-50/40',
                  )}
                >
                  <td className="px-5 py-2.5 text-xs text-slate-700">{row.device.name}</td>
                  <td className="px-2 py-2.5 font-mono text-xs font-semibold text-slate-800">
                    {row.deviceEmployeeNo}
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">
                    {/* Shown only as a hint for whoever is reviewing. Never used to
                        resolve the mapping, because this field is editable at the
                        terminal itself. */}
                    {row.deviceName ?? (
                      <span className="text-slate-400 italic">
                        <T k="mapping.row.noName" />
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <Credentials
                      face={row.numOfFace}
                      fingerprint={row.numOfFp}
                      card={row.numOfCard}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    {row.scanCount > 0 ? (
                      <span className="inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-rose-700 uppercase">
                        <T k="mapping.row.lost" vars={{ count: row.scanCount }} />
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 pr-4">
                    <RowActions>
                      <RowAction
                        icon={<Link2 className="size-4" aria-hidden />}
                        label={t('mapping.row.map')}
                        tone="success"
                        onClick={() => setActive(row)}
                      />
                      <ExpandButton
                        expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.id)}
                        label={t('mapping.row.expand')}
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
                        <Detail
                          label={<T k="mapping.column.terminal" />}
                          value={row.device.name}
                        />
                        <Detail
                          label={<T k="mapping.column.terminalId" />}
                          value={row.deviceEmployeeNo}
                          mono
                        />
                        <Detail
                          label={<T k="mapping.column.terminalName" />}
                          value={row.deviceName ?? '—'}
                        />
                        <Detail
                          label={<T k="mapping.detail.face" />}
                          value={String(row.numOfFace)}
                        />
                        <Detail
                          label={<T k="mapping.detail.fingerprint" />}
                          value={String(row.numOfFp)}
                        />
                        <Detail
                          label={<T k="mapping.detail.card" />}
                          value={String(row.numOfCard)}
                        />
                        <Detail
                          label={<T k="mapping.detail.firstSeen" />}
                          value={formatDateTime(row.firstSeenAt)}
                        />
                        <Detail
                          label={<T k="mapping.detail.lastSeen" />}
                          value={formatDateTime(row.lastSeenAt)}
                        />
                        <Detail
                          label={<T k="mapping.detail.heldScans" />}
                          value={String(row.scanCount)}
                        />
                      </DetailGrid>

                      <PanelNote className="mt-3">
                        <T k="mapping.detail.nameWarning" />
                      </PanelNote>
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
        onRefresh={onReload}
      />

      {active !== null && (
        <MapDialog
          target={active}
          onClose={() => setActive(null)}
          onDone={async (message) => {
            setActive(null);
            await onMapped(message);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Auto-matched, awaiting confirmation
// ---------------------------------------------------------------------------

function UnconfirmedPanel({
  rows,
  loading,
  busy,
  onReload,
  onConfirmed,
  onError,
  setBusy,
}: {
  rows: UnconfirmedMapping[];
  loading: boolean;
  busy: boolean;
  onReload: () => void;
  onConfirmed: (message: string) => Promise<void>;
  onError: (message: string) => void;
  setBusy: (value: boolean) => void;
}): ReactNode {
  const { t } = useLabels();

  async function confirm(mapping: UnconfirmedMapping): Promise<void> {
    setBusy(true);
    try {
      const result = await identityApi.map({
        deviceId: mapping.deviceId,
        deviceEmployeeNo: mapping.deviceEmployeeNo,
        staffId: mapping.staff.id,
      });
      await onConfirmed(
        t('mapping.unconfirmed.done', {
          name: mapping.staff.fullName,
          note: t(result.noteKey, { count: result.backfilled }),
        }),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('mapping.unconfirmed.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelSection
        title={
          rows.length === 0 ? (
            <T k="mapping.unconfirmed.none" />
          ) : (
            <T k="mapping.unconfirmed.count" vars={{ count: rows.length }} />
          )
        }
        subtitle={<T k="mapping.unconfirmed.subtitle" />}
      />

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="mapping.unconfirmed.empty" />}
        columns={[
          { header: <T k="mapping.column.terminal" />, width: 'w-40' },
          { header: <T k="mapping.column.terminalId" />, width: 'w-32' },
          { header: <T k="mapping.column.matchedTo" /> },
          { header: <T k="staff.column.employeeNo" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {rows.map((mapping) => (
          <tr key={mapping.id} className="border-b border-slate-100 bg-amber-50/40 hover:bg-amber-50/70">
            <td className="px-5 py-2.5 text-xs text-slate-700">{mapping.device.name}</td>
            <td className="px-2 py-2.5 font-mono text-xs font-semibold text-slate-800">
              {mapping.deviceEmployeeNo}
            </td>
            <td className="px-2 py-2.5 font-medium text-slate-800">{mapping.staff.fullName}</td>
            <td className="px-2 py-2.5 font-mono text-xs text-slate-600">
              {mapping.staff.employeeNo}
            </td>
            <td className="px-2 py-2.5 pr-4">
              <RowActions>
                <RowAction
                  icon={<CircleCheck className="size-4" aria-hidden />}
                  label={t('mapping.unconfirmed.confirm')}
                  tone="success"
                  disabled={busy}
                  onClick={() => void confirm(mapping)}
                />
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelBody className="pt-4">
        <PanelNote icon={<TriangleAlert className="size-3.5" aria-hidden />} tone="warn">
          <T k="mapping.unconfirmed.warning" />
        </PanelNote>
      </PanelBody>

      <PanelFooter
        shown={rows.length}
        total={rows.length}
        page={1}
        pageSize={Math.max(1, rows.length)}
        pageSizes={[Math.max(1, rows.length)]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={onReload}
      />
    </>
  );
}

function Credentials({
  face,
  fingerprint,
  card,
}: {
  face: number;
  fingerprint: number;
  card: number;
}): ReactNode {
  const { t } = useLabels();

  return (
    <span className="inline-flex items-center gap-1.5">
      <ScanFace
        className={cn('size-3.5', face > 0 ? 'text-emerald-600' : 'text-slate-300')}
        aria-label={t(
          face > 0 ? 'staff.biometric.face.present' : 'staff.biometric.face.absent',
        )}
      />
      <Fingerprint
        className={cn('size-3.5', fingerprint > 0 ? 'text-emerald-600' : 'text-slate-300')}
        aria-label={t(
          fingerprint > 0
            ? 'staff.biometric.fingerprint.present'
            : 'staff.biometric.fingerprint.absent',
        )}
      />
      <IdCard
        className={cn('size-3.5', card > 0 ? 'text-emerald-600' : 'text-slate-300')}
        aria-label={t(
          card > 0 ? 'staff.biometric.card.present' : 'staff.biometric.card.absent',
        )}
      />
    </span>
  );
}

/** Staff picker for one terminal identifier. */
function MapDialog({
  target,
  onClose,
  onDone,
}: {
  target: UnmappedUser;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [query, setQuery] = useState(target.deviceName ?? '');
  const [results, setResults] = useState<StaffCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  useEffect(() => {
    let cancelled = false;
    // Debounced so typing a name does not fire a request per keystroke.
    const timer = setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const rows = await identityApi.searchStaff(query, target.deviceId);
          if (!cancelled) setResults(rows);
        } catch (cause) {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : t('mapping.dialog.searchError'));
          }
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, target.deviceId, t]);

  async function choose(candidate: StaffCandidate): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await identityApi.map({
        deviceId: target.deviceId,
        deviceEmployeeNo: target.deviceEmployeeNo,
        staffId: candidate.id,
      });
      await onDone(
        t('mapping.dialog.done', {
          name: candidate.fullName,
          employeeNo: target.deviceEmployeeNo,
          note: t(result.noteKey, { count: result.backfilled }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mapping.dialog.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="mapping.dialog.title" />}
      titleText={t('mapping.dialog.title')}
      description={
        <T
          k={
            target.deviceName !== null
              ? 'mapping.dialog.description.named'
              : 'mapping.dialog.description'
          }
          vars={{
            device: target.device.name,
            employeeNo: target.deviceEmployeeNo,
            name: target.deviceName ?? '',
          }}
        />
      }
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-3">
        <Feedback error={error} />

        <div>
          <label htmlFor="staff-search" className="block text-sm font-medium text-slate-700">
            <T k="mapping.dialog.search" />
          </label>
          <div className="relative mt-1.5">
            <Search
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400"
              aria-hidden
            />
            <input
              id="staff-search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('mapping.dialog.search.placeholder')}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
          {searching && results.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              <T k="mapping.dialog.searching" />
            </p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              <T k="mapping.dialog.noMatch" />
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {results.map((candidate) => {
                // Flagged before the attempt rather than after being refused: one person
                // holding two ids on a terminal would split their day across both.
                const clash = candidate.existingDeviceEmployeeNo !== null;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      disabled={busy || clash}
                      onClick={() => void choose(candidate)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {candidate.fullName}
                        </p>
                        <p className="truncate font-mono text-xs text-slate-500">
                          {candidate.employeeNo}
                          {candidate.department ? ` · ${candidate.department.name}` : ''}
                        </p>
                      </div>
                      {clash && (
                        <Badge tone="warning">
                          <T
                            k="mapping.dialog.clash"
                            vars={{ employeeNo: candidate.existingDeviceEmployeeNo }}
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

        <PanelNote tone="success">
          <T k="mapping.dialog.note" />
        </PanelNote>

        <div className="flex justify-end border-t border-slate-200 pt-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            <X className="size-4" aria-hidden />
            <T k="dialog.close" />
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
