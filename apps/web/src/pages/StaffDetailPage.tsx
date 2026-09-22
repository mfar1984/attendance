import type { LabelKey } from '@attendance/shared';
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Fingerprint,
  History,
  IdCard,
  Loader2,
  Pencil,
  RefreshCw,
  ScanFace,
  ScrollText,
  TriangleAlert,
  User,
  UserX,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';

import { ControlCell, ControlGrid, SelectControl, SettingRow, TextControl } from '../components/ChannelForm';
import { Dialog, Feedback } from '../components/Dialog';
import {
  PanelActions,
  PanelBody,
  PanelFooter,
  PanelNote,
  PanelSection,
  PanelTabs,
  RecordTable,
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { StaffFormDialog } from '../components/StaffFormDialog';
import { Badge, Button } from '../components/ui';
import {
  staffApi,
  type StaffDetail,
  type StaffIdentities,
  type StaffScanPage,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  attendanceApi,
  exceptionsApi,
  DIRECTION_LABELS,
  EVENT_LABELS,
  EXCEPTION_LABELS,
  formatDateOnly,
  formatDateTime,
  formatMinutes,
  formatTime,
  lookupsApi,
  METHOD_LABELS,
  PUNCH_SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  type AttendancePage,
  type ExceptionPage,
  type Lookups,
} from '../lib/operations-api';
import {
  leaveApi,
  rosterApi,
  LEAVE_STATUS_LABELS,
  ROSTER_ENTRY_LABELS,
  type LeaveBalance,
  type LeaveRequestPage,
  type RosterPage,
} from '../lib/reports-api';
import { formatRinggit } from '../lib/overtime-api';
import {
  logsApi,
  ACTION_TONES,
  AUDIT_ACTION_LABELS,
  type AuditLogPage,
} from '../lib/settings-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * One staff member, in full.
 *
 * A page rather than the expanded table row it replaces. The row could only render the nine
 * fields the list query already had, so the address, job title, work pattern and per-terminal
 * identifiers were fetched and discarded — and the attendance, exceptions, leave and audit
 * trail for one person were unreachable without going to four other screens and filtering.
 *
 * Five of the six tabs run on filters the server already accepted and nothing had ever sent.
 */
export function StaffDetailPage(): ReactNode {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useLabels();
  const { can } = useAuth();
  const staffId = Number(params.id);

  const [tab, setTab] = useState('details');
  const [staff, setStaff] = useState<StaffDetail | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStaff(await staffApi.get(staffId));
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t('staff.view.error.load'));
    }
  }, [staffId, t]);

  useEffect(() => {
    void load();
    void lookupsApi.load().then(setLookups).catch(() => undefined);
  }, [load]);

  async function deactivate(): Promise<void> {
    setBusy(true);
    try {
      const result = await staffApi.deactivate(staffId);
      const failed = result.removal.filter((row) => !row.ok);
      setNotice(
        failed.length === 0
          ? t('staff.view.deactivated', { name: staff?.fullName ?? '' })
          : t('staff.view.deactivated.partial', {
              name: staff?.fullName ?? '',
              count: failed.length,
            }),
      );
      setConfirming(false);
      await load();
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError !== null && staff === null) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <PanelBody>
          <Feedback error={loadError} />
        </PanelBody>
      </section>
    );
  }

  if (staff === null) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
        </div>
      </section>
    );
  }

  const canScan = staff.numOfFace > 0 || staff.numOfFp > 0 || staff.numOfCard > 0;
  const blocked = staff.active && !canScan;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={() => void navigate('/staf')}
            aria-label={t('staff.view.back.aria')}
            className="mt-0.5 rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>

          {/*
            Avatar, served with a session and no screen permission — it is a picture of a
            colleague, and every screen that lists people needs to show it. Falls back to an
            icon rather than a broken image when nobody has uploaded one.
          */}
          <Avatar staffId={staff.id} name={staff.fullName} hasPhoto={staff.photoPath !== null} />

          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-800">
              {staff.fullName}
              <Badge tone={staff.active ? 'success' : 'neutral'}>
                <T k={staff.active ? 'app.status.active' : 'app.status.inactive'} />
              </Badge>
              {/*
                On the header, not inside a tab. This is the most consequential fact about a
                staff record — the person exists on the terminal and cannot record attendance,
                and nothing errors when they try — so it stays visible whichever tab is open.
              */}
              {blocked && (
                <Badge tone="danger">
                  <TriangleAlert className="size-3" aria-hidden />
                  <T k="staff.status.cannotScan" />
                </Badge>
              )}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              <span className="font-mono">#{staff.employeeNo}</span>
              {[staff.position, staff.department?.name, staff.location?.name]
                .filter((part): part is string => part !== null && part !== undefined)
                .map((part) => ` · ${part}`)
                .join('')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {can('staff.directory', 'edit') && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              <T k="staff.view.edit" />
            </Button>
          )}
          {staff.active && can('staff.directory', 'delete') && (
            <Button
              variant="ghost"
              onClick={() => setConfirming(true)}
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              <UserX className="size-4" aria-hidden />
              <T k="staff.view.deactivate" />
            </Button>
          )}
        </div>
      </header>

      <PanelTabs
        label={t('staff.view.tabs.aria')}
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'details',
            label: <T k="staff.view.tab.details" />,
            labelText: t('staff.view.tab.details'),
            icon: <User className="size-4" aria-hidden />,
          },
          {
            id: 'terminal',
            label: <T k="staff.view.tab.terminal" />,
            labelText: t('staff.view.tab.terminal'),
            icon: <ScanFace className="size-4" aria-hidden />,
          },
          {
            id: 'attendance',
            label: <T k="staff.view.tab.attendance" />,
            labelText: t('staff.view.tab.attendance'),
            icon: <CalendarDays className="size-4" aria-hidden />,
          },
          {
            id: 'exceptions',
            label: <T k="staff.view.tab.exceptions" />,
            labelText: t('staff.view.tab.exceptions'),
            icon: <TriangleAlert className="size-4" aria-hidden />,
          },
          {
            id: 'roster',
            label: <T k="staff.view.tab.roster" />,
            labelText: t('staff.view.tab.roster'),
            icon: <CalendarClock className="size-4" aria-hidden />,
          },
          {
            id: 'leave',
            label: <T k="staff.view.tab.leave" />,
            labelText: t('staff.view.tab.leave'),
            icon: <ClipboardList className="size-4" aria-hidden />,
          },
          /*
            Hidden without the raw log grant rather than shown and refused. A tab that leads
            to a 403 teaches the operator that the screen is broken, not that they lack a
            permission — and this one serves the evidence table, which is view-only for every
            role including Super Admin.
          */
          ...(can('attendance.rawLog', 'view')
            ? [
                {
                  id: 'scans',
                  label: <T k="staff.view.tab.scans" />,
                  labelText: t('staff.view.tab.scans'),
                  icon: <ScrollText className="size-4" aria-hidden />,
                },
              ]
            : []),
          {
            id: 'audit',
            label: <T k="staff.view.tab.audit" />,
            labelText: t('staff.view.tab.audit'),
            icon: <History className="size-4" aria-hidden />,
          },
        ]}
      />

      {notice !== null && (
        <PanelBody className="pb-0">
          <Feedback notice={notice} />
        </PanelBody>
      )}

      {tab === 'details' && <DetailsTab staff={staff} blocked={blocked} />}
      {tab === 'terminal' && <TerminalTab staff={staff} onChanged={load} />}
      {tab === 'attendance' && <AttendanceTab staffId={staff.id} />}
      {tab === 'exceptions' && <ExceptionsTab staffId={staff.id} />}
      {tab === 'roster' && <RosterTab staffId={staff.id} shifts={lookups?.shifts ?? []} />}
      {tab === 'leave' && <LeaveTab staffId={staff.id} />}
      {tab === 'scans' && can('attendance.rawLog', 'view') && <ScansTab staffId={staff.id} />}
      {tab === 'audit' && <AuditTab staffId={staff.id} />}

      {editing && (
        <StaffFormDialog
          staffId={staff.id}
          lookups={lookups}
          onClose={() => setEditing(false)}
          onSaved={async (message) => {
            setEditing(false);
            setNotice(message);
            await load();
          }}
        />
      )}

      {confirming && (
        <Dialog
          title={<T k="staff.deactivate.title" vars={{ name: staff.fullName }} />}
          titleText={t('staff.deactivate.title', { name: staff.fullName })}
          onClose={() => setConfirming(false)}
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
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void deactivate()}
                disabled={busy}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="staff.deactivate.submit" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Details
// ---------------------------------------------------------------------------

function DetailsTab({ staff, blocked }: { staff: StaffDetail; blocked: boolean }): ReactNode {
  const address = [
    staff.addressLine1,
    staff.addressLine2,
    [staff.postcode, staff.city].filter(Boolean).join(' '),
    staff.state,
    staff.country,
  ]
    .filter((part): part is string => part !== null && part !== undefined && part.trim() !== '')
    .join(', ');

  return (
    <>
      <PanelSection
        icon={<User className="size-4" aria-hidden />}
        title={<T k="staff.view.details.title" />}
        subtitle={<T k="staff.view.details.subtitle" />}
      />

      <SettingsStack>
        {blocked && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="staff.detail.blockedWarning" />
          </PanelNote>
        )}

        <SettingsGroup
          title={<T k="staff.view.group.identity" />}
          icon={<IdCard className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <T k="staff.view.managedByHr" />
            </span>
          }
        >
          <SettingRow
            label={<T k="staff.detail.employeeNo" />}
            hint={<T k="staff.view.employeeNo.hint" />}
          >
            <ReadOnly value={staff.employeeNo} mono />
          </SettingRow>

          <SettingRow label={<T k="staff.view.field.icNo" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="staff.view.field.icNo" />}>
                <ReadOnly value={staff.icNo} mono />
              </ControlCell>
              <ControlCell caption={<T k="staff.view.field.position" />}>
                <ReadOnly value={staff.position} />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow label={<T k="staff.view.field.posting" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="staff.detail.department" />}>
                <ReadOnly value={staff.department?.name ?? null} />
              </ControlCell>
              <ControlCell caption={<T k="staff.detail.location" />}>
                <ReadOnly value={staff.location?.name ?? null} />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="staff.view.field.dates" />}
            hint={<T k="staff.view.field.dates.hint" />}
          >
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="staff.view.field.hireDate" />}>
                {/* A calendar column, so `formatDateOnly` — no time zone involved. */}
                <ReadOnly value={formatDateOnly(staff.hireDate)} />
              </ControlCell>
              <ControlCell caption={<T k="staff.view.field.validFrom" />}>
                <ReadOnly value={formatDateTime(staff.validFrom)} />
              </ControlCell>
              <ControlCell caption={<T k="staff.view.field.validTo" />}>
                <ReadOnly value={formatDateTime(staff.validTo)} />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="staff.view.field.workPattern" />}
            hint={<T k="staff.view.field.workPattern.hint" />}
          >
            <ReadOnly value={staff.workPattern?.name ?? null} />
          </SettingRow>

          {/*
            Shown only to a caller holding the `salary` action. Without it the server does
            not send the figure at all, so the row would be a blank that reads as "no wage
            recorded" — a different fact from "you may not see this".
          */}
          {staff.canReadSalary && (
            <SettingRow
              label={<T k="staff.view.field.basicSalary" />}
              hint={<T k="staff.view.field.basicSalary.hint" />}
            >
              <ControlGrid columns={2}>
                <ControlCell caption={<T k="staff.view.field.basicSalary.monthly" />}>
                  <ReadOnly
                    value={
                      staff.basicSalary === null || staff.basicSalary === undefined
                        ? null
                        : formatRinggit(staff.basicSalary)
                    }
                  />
                </ControlCell>
                <ControlCell caption={<T k="staff.view.field.basicSalary.hourly" />}>
                  {/*
                    Derived here for reading, not stored. The figure frozen onto a claim is
                    the one computed on the server at submission — this is the same
                    arithmetic so somebody can check a claim against the wage on file.
                  */}
                  <ReadOnly
                    value={
                      staff.basicSalary === null ||
                      staff.basicSalary === undefined ||
                      staff.basicSalary <= 0
                        ? null
                        : formatRinggit(Math.round((staff.basicSalary / 208) * 100) / 100)
                    }
                  />
                </ControlCell>
              </ControlGrid>
            </SettingRow>
          )}
        </SettingsGroup>

        <SettingsGroup
          title={<T k="staff.view.group.contact" />}
          icon={<User className="size-3.5" aria-hidden />}
        >
          <SettingRow label={<T k="staff.view.field.contact" />}>
            <ControlGrid columns={2}>
              <ControlCell caption={<T k="staff.view.field.phone" />}>
                <ReadOnly value={staff.phone} mono />
              </ControlCell>
              <ControlCell caption={<T k="staff.view.field.email" />}>
                <ReadOnly value={staff.email} />
              </ControlCell>
            </ControlGrid>
          </SettingRow>

          <SettingRow
            label={<T k="staff.view.field.address" />}
            hint={<T k="staff.view.field.address.hint" />}
          >
            <ReadOnly value={address === '' ? null : address} />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="staff.view.group.access" />}
          icon={<Fingerprint className="size-3.5" aria-hidden />}
          action={
            <span
              className={cn(
                'text-[11px] font-semibold tracking-wide uppercase',
                staff.hasDoorPin ? 'text-emerald-700' : 'text-slate-400',
              )}
            >
              <T k={staff.hasDoorPin ? 'staff.view.pin.set' : 'staff.view.pin.unset'} />
            </span>
          }
        >
          <SettingRow
            label={<T k="staff.detail.account" />}
            hint={<T k="staff.view.field.account.hint" />}
          >
            {staff.account === null ? (
              <ReadOnly value={null} />
            ) : (
              <ControlGrid columns={2}>
                <ControlCell caption={<T k="staff.view.field.loginEmail" />}>
                  <ReadOnly value={staff.account.email} />
                </ControlCell>
                <ControlCell caption={<T k="panel.column.status" />}>
                  <ReadOnly value={staff.account.status} mono />
                </ControlCell>
              </ControlGrid>
            )}
          </SettingRow>

          <SettingRow
            label={<T k="staff.detail.appCheckIn" />}
            hint={<T k="staff.view.field.appCheckIn.hint" />}
          >
            <ReadOnly
              value={
                <T
                  k={
                    staff.account?.allowAppCheckIn === true
                      ? 'staff.detail.appCheckIn.allowed'
                      : 'staff.detail.appCheckIn.denied'
                  }
                />
              }
            />
          </SettingRow>
        </SettingsGroup>

        {staff.notes !== null && staff.notes.trim() !== '' && (
          <SettingsGroup
            title={<T k="staff.view.group.notes" />}
            icon={<ClipboardList className="size-3.5" aria-hidden />}
          >
            <p className="py-2 text-sm whitespace-pre-wrap text-slate-700">{staff.notes}</p>
          </SettingsGroup>
        )}

        <SettingsGroup
          title={<T k="staff.view.group.record" />}
          icon={<History className="size-3.5" aria-hidden />}
        >
          <SettingRow label={<T k="staff.view.field.recordDates" />}>
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="staff.detail.staffId" />}>
                <ReadOnly value={String(staff.id)} mono />
              </ControlCell>
              <ControlCell caption={<T k="panel.column.created" />}>
                <ReadOnly value={formatDateTime(staff.createdAt)} />
              </ControlCell>
              <ControlCell caption={<T k="staff.view.field.updatedAt" />}>
                <ReadOnly value={formatDateTime(staff.updatedAt)} />
              </ControlCell>
            </ControlGrid>
          </SettingRow>
        </SettingsGroup>
      </SettingsStack>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Terminal and biometrics
// ---------------------------------------------------------------------------

function TerminalTab({
  staff,
  onChanged,
}: {
  staff: StaffDetail;
  onChanged: () => Promise<void>;
}): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  const [data, setData] = useState<StaffIdentities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await staffApi.identities(staff.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.error.load'));
    }
  }, [staff.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const counts = await staffApi.refreshCredentials(staff.id);
      setNotice(
        t('staff.view.terminal.refreshed', {
          face: counts.numOfFace,
          fingerprint: counts.numOfFp,
          card: counts.numOfCard,
        }),
      );
      await Promise.all([load(), onChanged()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.terminal.refresh.error'));
    } finally {
      setBusy(false);
    }
  }

  async function resync(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await staffApi.resync(staff.id);
      const failed = result.sync.filter((row) => !row.ok);
      setNotice(
        failed.length === 0
          ? t('staff.view.terminal.resynced', { count: result.sync.length })
          : t('staff.view.terminal.resynced.partial', {
              count: result.sync.length,
              failed: failed.map((row) => `${row.deviceName}: ${row.error ?? ''}`).join('; '),
            }),
      );
      await Promise.all([load(), onChanged()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.terminal.resync.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelSection
        icon={<ScanFace className="size-4" aria-hidden />}
        title={<T k="staff.view.terminal.title" />}
        subtitle={<T k="staff.view.terminal.subtitle" />}
        action={
          <Button variant="ghost" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            <T k="staff.view.terminal.refresh" />
          </Button>
        }
      />

      <SettingsStack>
        <Feedback error={error} notice={notice} />

        <SettingsGroup
          title={<T k="staff.view.terminal.group.credentials" />}
          icon={<Fingerprint className="size-3.5" aria-hidden />}
          action={
            <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <T
                k="staff.view.terminal.counts"
                vars={{
                  face: staff.numOfFace,
                  fingerprint: staff.numOfFp,
                  card: staff.numOfCard,
                }}
              />
            </span>
          }
        >
          <SettingRow
            label={<T k="staff.view.terminal.face" />}
            hint={<T k="staff.view.terminal.face.hint" />}
          >
            <div className="flex items-start gap-3">
              {staff.numOfFace > 0 ? (
                <img
                  src={`/api/staff/${String(staff.id)}/face`}
                  alt={t('biometrics.row.faceAlt', { name: staff.fullName })}
                  className="size-20 rounded-lg border border-slate-200 object-cover"
                />
              ) : (
                <div className="grid size-20 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
                  <ScanFace className="size-6 text-slate-300" aria-hidden />
                </div>
              )}
              <p className="min-w-0 flex-1 text-xs text-slate-600">
                <T
                  k={
                    staff.numOfFace > 0
                      ? 'staff.view.terminal.face.present'
                      : 'staff.view.terminal.face.absent'
                  }
                />
              </p>
            </div>
          </SettingRow>

          <SettingRow label={<T k="staff.view.terminal.credentialCounts" />}>
            <ControlGrid columns={3}>
              <ControlCell caption={<T k="staff.detail.faces" />}>
                <ReadOnly value={String(staff.numOfFace)} mono />
              </ControlCell>
              <ControlCell caption={<T k="staff.detail.fingerprints" />}>
                <ReadOnly value={String(staff.numOfFp)} mono />
              </ControlCell>
              <ControlCell caption={<T k="staff.detail.cards" />}>
                <ReadOnly value={String(staff.numOfCard)} mono />
              </ControlCell>
            </ControlGrid>
          </SettingRow>
        </SettingsGroup>

        {/*
          The group that answers "which id is this person on each door". Impossible to see
          anywhere else once the numbers differ per unit, and they do on any terminal that was
          populated before this system arrived.
        */}
        <SettingsGroup
          title={<T k="staff.view.terminal.group.identities" />}
          icon={<IdCard className="size-3.5" aria-hidden />}
          subtitle={<T k="staff.view.terminal.group.identities.subtitle" />}
          action={
            <span className="font-mono text-[11px] text-slate-500">
              #{data?.canonicalEmployeeNo ?? staff.employeeNo}
            </span>
          }
        >
          {data !== null && data.identities.length === 0 ? (
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T k="staff.view.terminal.noTerminals" />
            </PanelNote>
          ) : (
            <div className="divide-y divide-slate-100">
              {(data?.identities ?? []).map((row) => (
                <div key={row.deviceId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700">{row.deviceName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <T
                        k="staff.view.terminal.identity.detail"
                        vars={{
                          employeeNo: row.deviceEmployeeNo,
                          face:
                            row.faceEnrolledAt === null
                              ? t('staff.view.terminal.identity.noFace')
                              : formatDateOnly(row.faceEnrolledAt),
                        }}
                      />
                    </p>
                  </div>
                  {!row.confirmed && (
                    <Badge tone="warning">
                      <T k="staff.view.terminal.unconfirmed" />
                    </Badge>
                  )}
                  <Badge
                    tone={
                      row.deviceStatus === 'online'
                        ? 'success'
                        : row.deviceStatus === 'offline'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    <TEnum k={DEVICE_STATUS_LABELS[row.deviceStatus]} fallback={row.deviceStatus} />
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {(staff.enrolments.some((row) => row.lastError !== null) ?? false) && (
            <PanelNote tone="danger" className="mt-2">
              {staff.enrolments
                .filter((row) => row.lastError !== null)
                .map((row) => `${row.device.name}: ${row.lastError ?? ''}`)
                .join(' · ')}
            </PanelNote>
          )}
        </SettingsGroup>
      </SettingsStack>

      {can('staff.directory', 'resync') && (
        <PanelActions hint={<T k="staff.view.terminal.resync.hint" />}>
          <Button onClick={() => void resync()} disabled={busy}>
            <RefreshCw className="size-4" aria-hidden />
            <T k="staff.view.terminal.resync" />
          </Button>
        </PanelActions>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Attendance
// ---------------------------------------------------------------------------

function AttendanceTab({ staffId }: { staffId: number }): ReactNode {
  const { t, tEnum } = useLabels();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(31);
  const [data, setData] = useState<AttendancePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = monthRange(month);
      setData(
        await attendanceApi.records({
          page,
          pageSize,
          staffId,
          from,
          to,
          ...(status === '' ? {} : { status }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('records.error.load'));
    } finally {
      setLoading(false);
    }
  }, [month, page, pageSize, staffId, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        icon={<CalendarDays className="size-4" aria-hidden />}
        title={<T k="staff.view.attendance.title" />}
        subtitle={<T k="staff.view.attendance.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} />
        <ControlGrid columns={3}>
          <ControlCell caption={<T k="staff.view.attendance.month" />}>
            <TextControl
              label={t('staff.view.attendance.month')}
              type="month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setPage(1);
              }}
            />
          </ControlCell>
          <ControlCell caption={<T k="panel.column.status" />}>
            <SelectControl
              label={t('panel.column.status')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('staff.view.attendance.allStatuses')}</option>
              {Object.keys(STATUS_LABELS).map((key) => (
                <option key={key} value={key}>
                  {tEnum(STATUS_LABELS[key], key)}
                </option>
              ))}
            </SelectControl>
          </ControlCell>
          <ControlCell caption={<T k="staff.view.attendance.summary" />}>
            <ReadOnly
              value={
                data === null
                  ? '—'
                  : Object.entries(data.byStatus)
                      .map(([key, count]) => `${tEnum(STATUS_LABELS[key], key)} ${String(count)}`)
                      .join(' · ') || t('staff.view.attendance.none')
              }
            />
          </ControlCell>
        </ControlGrid>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="staff.view.attendance.empty" />}
        columns={[
          { header: <T k="records.column.date" />, width: 'w-28' },
          { header: <T k="records.column.shift" />, width: 'w-24' },
          { header: <T k="records.column.scheduled" />, width: 'w-32' },
          { header: <T k="records.column.in" />, width: 'w-24' },
          { header: <T k="records.column.out" />, width: 'w-24' },
          { header: <T k="records.column.late" />, width: 'w-20' },
          { header: <T k="records.column.worked" />, width: 'w-24' },
          { header: <T k="panel.column.status" />, width: 'w-32' },
        ]}
      >
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2 text-xs text-slate-700">{formatDateOnly(row.workDate)}</td>
            <td className="px-2 py-2 text-xs text-slate-600">
              {row.shift === null ? t('records.row.defaultShift') : row.shift.code}
            </td>
            <td className="px-2 py-2 font-mono text-xs text-slate-500">
              {row.scheduledStart === null
                ? '—'
                : `${formatTime(row.scheduledStart)}–${formatTime(row.scheduledEnd)}`}
            </td>
            <td className="px-2 py-2 font-mono text-xs text-slate-700">
              {formatTime(row.checkInAt)}
            </td>
            <td className="px-2 py-2 font-mono text-xs text-slate-700">
              {formatTime(row.checkOutAt)}
            </td>
            <td className="px-2 py-2 text-xs text-amber-700">{formatMinutes(row.lateMinutes)}</td>
            <td className="px-2 py-2 text-xs text-slate-700">
              {formatMinutes(row.workedMinutes)}
            </td>
            <td className="px-2 py-2">
              <Badge tone={STATUS_TONES[row.status] ?? 'neutral'}>
                <span className="uppercase">
                  <TEnum k={STATUS_LABELS[row.status]} fallback={row.status} />
                </span>
              </Badge>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={data?.total ?? 0}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — Exceptions
// ---------------------------------------------------------------------------

function ExceptionsTab({ staffId }: { staffId: number }): ReactNode {
  const { t } = useLabels();
  const [resolved, setResolved] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [data, setData] = useState<ExceptionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await exceptionsApi.list({
          page,
          pageSize,
          staffId,
          ...(resolved === '' ? {} : { resolved: resolved === 'yes' }),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('exceptions.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, resolved, staffId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        icon={<TriangleAlert className="size-4" aria-hidden />}
        title={<T k="staff.view.exceptions.title" />}
        subtitle={<T k="staff.view.exceptions.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} />
        <ControlGrid columns={2}>
          <ControlCell caption={<T k="panel.column.status" />}>
            <SelectControl
              label={t('panel.column.status')}
              value={resolved}
              onChange={(event) => {
                setResolved(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('exceptions.filter.allStatuses')}</option>
              <option value="no">{t('exceptions.filter.open')}</option>
              <option value="yes">{t('exceptions.filter.resolved')}</option>
            </SelectControl>
          </ControlCell>
        </ControlGrid>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="staff.view.exceptions.empty" />}
        columns={[
          { header: <T k="exceptions.column.kind" />, width: 'w-44' },
          { header: <T k="exceptions.column.occurred" />, width: 'w-40' },
          { header: <T k="exceptions.column.terminal" />, width: 'w-32' },
          { header: <T k="exceptions.column.detail" /> },
          { header: <T k="panel.column.status" />, width: 'w-28' },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.resolvedAt === null && 'bg-amber-50/40',
            )}
          >
            <td className="px-5 py-2 text-xs font-medium text-slate-700">
              <TEnum k={EXCEPTION_LABELS[row.kind]} fallback={row.kind} />
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">{formatDateTime(row.occurredAt)}</td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.deviceName ?? '—'}</td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.detail ?? '—'}</td>
            <td className="px-2 py-2">
              {row.resolvedAt === null ? (
                <Badge tone="warning">
                  <T k="exceptions.filter.open" />
                </Badge>
              ) : (
                <Badge tone="success">
                  <T k="exceptions.row.done" />
                </Badge>
              )}
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={data?.total ?? 0}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Roster
// ---------------------------------------------------------------------------

/**
 * What this person was scheduled for, as opposed to what they did.
 *
 * Separate from the attendance tab because the two answer different questions and can
 * disagree: a rostered day with no scan is an absence, and a scan on a rest day is an
 * exception. Seeing them in one list would hide which of the two a gap is.
 */
function RosterTab({
  staffId,
  shifts,
}: {
  staffId: number;
  shifts: Array<{ id: number; code: string; name: string }>;
}): ReactNode {
  const { t } = useLabels();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<RosterPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = monthRange(month);
      setData(await rosterApi.list({ from, to, staffId }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.roster.error'));
    } finally {
      setLoading(false);
    }
  }, [month, staffId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const row = data?.rows[0] ?? null;
  const shiftNames = new Map(shifts.map((shift) => [shift.id, shift]));
  const entries = [...(row?.rosters ?? [])].sort((a, b) => a.workDate.localeCompare(b.workDate));

  const counts = entries.reduce<Record<string, number>>((totals, entry) => {
    totals[entry.entryType] = (totals[entry.entryType] ?? 0) + 1;
    return totals;
  }, {});

  return (
    <>
      <PanelSection
        icon={<CalendarClock className="size-4" aria-hidden />}
        title={<T k="staff.view.roster.title" />}
        subtitle={<T k="staff.view.roster.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} />
        <ControlGrid columns={3}>
          <ControlCell caption={<T k="staff.view.attendance.month" />}>
            <TextControl
              label={t('staff.view.attendance.month')}
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </ControlCell>
          <ControlCell caption={<T k="staff.view.roster.pattern" />}>
            <ReadOnly value={row?.workPattern?.name ?? null} />
          </ControlCell>
          <ControlCell caption={<T k="staff.view.roster.summary" />}>
            <ReadOnly
              value={
                entries.length === 0
                  ? t('staff.view.roster.none')
                  : Object.entries(counts)
                      .map(
                        ([kind, count]) =>
                          `${t(ROSTER_ENTRY_LABELS[kind] ?? 'roster.cell.work')} ${String(count)}`,
                      )
                      .join(' · ')
              }
            />
          </ControlCell>
        </ControlGrid>

        {/*
          Days with no row are not rostered at all, which is a different state from a rest
          day. The engine falls back to the work pattern for those, so saying so here stops
          an empty month reading as "nothing scheduled".
        */}
        <PanelNote icon={<CalendarClock className="size-3.5" aria-hidden />}>
          <T k="staff.view.roster.note" />
        </PanelNote>
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={entries.length}
        empty={<T k="staff.view.roster.empty" />}
        columns={[
          { header: <T k="records.column.date" />, width: 'w-32' },
          { header: <T k="staff.view.roster.column.type" />, width: 'w-28' },
          { header: <T k="records.column.shift" />, width: 'w-48' },
          { header: <T k="staff.view.roster.column.notes" /> },
        ]}
      >
        {entries.map((entry) => {
          const shift = entry.shiftId === null ? undefined : shiftNames.get(entry.shiftId);
          return (
            <tr
              key={entry.workDate}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                entry.entryType === 'leave' && 'bg-amber-50/40',
                entry.entryType === 'rest' && 'bg-slate-50/60',
              )}
            >
              {/* A `@db.Date` column, so `formatDateOnly` — no time zone involved. */}
              <td className="px-5 py-2 text-xs text-slate-700">
                {formatDateOnly(entry.workDate)}
              </td>
              <td className="px-2 py-2">
                <Badge tone={ROSTER_TONES[entry.entryType] ?? 'neutral'}>
                  <span className="uppercase">
                    <TEnum k={ROSTER_ENTRY_LABELS[entry.entryType]} fallback={entry.entryType} />
                  </span>
                </Badge>
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                {shift === undefined ? '—' : `${shift.code} · ${shift.name}`}
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">{entry.notes ?? '—'}</td>
            </tr>
          );
        })}
      </RecordTable>

      <PanelFooter
        shown={entries.length}
        total={entries.length}
        page={1}
        pageSize={entries.length === 0 ? 1 : entries.length}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Scan timeline
// ---------------------------------------------------------------------------

/**
 * The evidence behind one person's attendance.
 *
 * Shows what the terminals reported and whether each report became a punch. A scan with no
 * punch is the row somebody is looking for when a day is missing — an unmapped identifier,
 * an unrecognised face, or a duplicate inside the dedup window.
 */
function ScansTab({ staffId }: { staffId: number }): ReactNode {
  const { t } = useLabels();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<StaffScanPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = monthRange(month);
      setData(await staffApi.scans(staffId, { from, to, limit: 200 }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.scans.error'));
    } finally {
      setLoading(false);
    }
  }, [month, staffId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const unresolved = rows.filter((row) => row.punchId === null).length;

  return (
    <>
      <PanelSection
        icon={<ScrollText className="size-4" aria-hidden />}
        title={<T k="staff.view.scans.title" />}
        subtitle={<T k="staff.view.scans.subtitle" />}
      />

      <PanelBody className="space-y-3">
        <Feedback error={error} />

        <ControlGrid columns={3}>
          <ControlCell caption={<T k="staff.view.attendance.month" />}>
            <TextControl
              label={t('staff.view.attendance.month')}
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </ControlCell>
          {/*
            The identifiers the raw side was matched on. Named because this is the one screen
            where the distinction matters: filtering by the canonical staff number would drop
            every scan from a terminal where the person carries a different one.
          */}
          <ControlCell
            caption={<T k="staff.view.scans.matchedOn" />}
            hint={<T k="staff.view.scans.matchedOn.hint" />}
          >
            <ReadOnly
              mono
              value={
                data === null || data.deviceEmployeeNos.length === 0
                  ? null
                  : data.deviceEmployeeNos.join(', ')
              }
            />
          </ControlCell>
          <ControlCell caption={<T k="staff.view.scans.summary" />}>
            <ReadOnly
              value={
                data === null
                  ? '—'
                  : t('staff.view.scans.counts', {
                      total: rows.length,
                      unresolved,
                    })
              }
            />
          </ControlCell>
        </ControlGrid>

        {data?.truncated === true && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="staff.view.scans.truncated" vars={{ limit: data.limit }} />
          </PanelNote>
        )}
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="staff.view.scans.empty" />}
        columns={[
          { header: <T k="staff.view.scans.column.at" />, width: 'w-40' },
          { header: <T k="exceptions.column.terminal" />, width: 'w-32' },
          { header: <T k="monitor.detail.terminalId" />, width: 'w-24' },
          { header: <T k="rawlog.column.event" />, width: 'w-36' },
          { header: <T k="monitor.column.method" />, width: 'w-24' },
          { header: <T k="staff.view.scans.column.outcome" /> },
        ]}
      >
        {rows.map((row) => (
          <tr
            key={`${row.punchId ?? 'raw'}-${row.rawEventId ?? String(row.at)}`}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              row.punchId === null && 'bg-amber-50/40',
              row.suppressed && 'bg-slate-50/60',
            )}
          >
            <td className="px-5 py-2 text-xs text-slate-700">{formatDateTime(row.at)}</td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.deviceName ?? '—'}</td>
            <td className="px-2 py-2 font-mono text-xs text-slate-500">
              {row.deviceEmployeeNo ?? '—'}
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              {row.major === null || row.minor === null ? (
                <TEnum k={PUNCH_SOURCE_LABELS[row.source]} fallback={row.source} />
              ) : (
                <TEnum
                  k={EVENT_LABELS[`${String(row.major)}:${String(row.minor)}`]}
                  fallback={`${String(row.major)}:${String(row.minor)}`}
                />
              )}
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              {row.method === null ? (
                '—'
              ) : (
                <TEnum k={METHOD_LABELS[row.method]} fallback={row.method} />
              )}
            </td>
            <td className="px-2 py-2 text-xs">
              {row.punchId === null ? (
                <Badge tone="warning">
                  <T k="staff.view.scans.noPunch" />
                </Badge>
              ) : row.suppressed ? (
                <Badge tone="neutral">
                  <T k="scan.suppressed" />
                </Badge>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Badge tone="success">
                    <T k="rawlog.row.recorded" />
                  </Badge>
                  <span className="text-slate-500">
                    <TEnum k={DIRECTION_LABELS[row.direction ?? '']} fallback={row.direction ?? ''} />
                  </span>
                </span>
              )}
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={rows.length}
        page={1}
        pageSize={rows.length === 0 ? 1 : rows.length}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Leave
// ---------------------------------------------------------------------------

function LeaveTab({ staffId }: { staffId: number }): ReactNode {
  const { t } = useLabels();
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [data, setData] = useState<LeaveRequestPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requests, balances] = await Promise.all([
        leaveApi.list({ page, pageSize, staffId }),
        leaveApi.balance(staffId, year),
      ]);
      setData(requests);
      setBalance(balances);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.leave.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, staffId, year, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        icon={<ClipboardList className="size-4" aria-hidden />}
        title={<T k="staff.view.leave.title" />}
        subtitle={<T k="staff.view.leave.subtitle" />}
      />

      <SettingsStack>
        <Feedback error={error} />

        <SettingsGroup
          title={<T k="staff.view.leave.group.balance" vars={{ year }} />}
          icon={<CalendarDays className="size-3.5" aria-hidden />}
          subtitle={<T k="staff.view.leave.group.balance.subtitle" />}
          action={
            <SelectControl
              label={t('staff.view.leave.year')}
              value={String(year)}
              className="w-28"
              onChange={(event) => setYear(Number(event.target.value))}
            >
              {yearOptions().map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectControl>
          }
        >
          {balance === null || balance.balances.length === 0 ? (
            <p className="py-2 text-sm text-slate-500">
              <T k="staff.view.leave.noTypes" />
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {balance.balances.map((row) => (
                <div key={row.type.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700">{row.type.name}</p>
                    {!row.type.paid && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        <T k="staff.view.leave.unpaid" />
                      </p>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-slate-500">
                    {/*
                      Pending days count against the balance. Without that, five separate
                      applications each pass the check and together exceed the entitlement.
                    */}
                    <T
                      k="staff.view.leave.balanceLine"
                      vars={{
                        entitlement:
                          row.annualDays === 0 ? t('staff.view.leave.unlimited') : row.annualDays,
                        taken: row.taken,
                        pending: row.pending,
                      }}
                    />
                  </span>
                  <span
                    className={cn(
                      'w-16 text-right text-sm font-semibold tabular-nums',
                      row.remaining === null
                        ? 'text-slate-400'
                        : row.remaining <= 0
                          ? 'text-rose-700'
                          : 'text-slate-800',
                    )}
                  >
                    {row.remaining === null ? '—' : row.remaining}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SettingsGroup>
      </SettingsStack>

      <PanelSection
        title={<T k="staff.view.leave.group.requests" />}
        subtitle={<T k="staff.view.leave.group.requests.subtitle" />}
      />

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="staff.view.leave.empty" />}
        columns={[
          { header: <T k="filter.from" />, width: 'w-28' },
          { header: <T k="filter.to" />, width: 'w-28' },
          { header: <T k="staff.view.leave.column.days" />, width: 'w-20' },
          { header: <T k="staff.view.leave.column.type" />, width: 'w-40' },
          { header: <T k="staff.view.leave.column.reason" /> },
          { header: <T k="panel.column.status" />, width: 'w-28' },
        ]}
      >
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2 text-xs text-slate-700">{formatDateOnly(row.fromDate)}</td>
            <td className="px-2 py-2 text-xs text-slate-700">{formatDateOnly(row.toDate)}</td>
            <td className="px-2 py-2 text-xs tabular-nums text-slate-700">{row.days}</td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.leaveType.name}</td>
            <td className="px-2 py-2 text-xs text-slate-600">{row.reason ?? '—'}</td>
            <td className="px-2 py-2">
              <Badge tone={LEAVE_TONES[row.status] ?? 'neutral'}>
                <span className="uppercase">
                  <T k={LEAVE_STATUS_LABELS[row.status]} />
                </span>
              </Badge>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={rows.length}
        total={data?.total ?? 0}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Audit trail
// ---------------------------------------------------------------------------

function AuditTab({ staffId }: { staffId: number }): ReactNode {
  const { t } = useLabels();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await logsApi.audit({
          page,
          pageSize,
          entityType: 'Staff',
          entityId: String(staffId),
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.view.audit.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, staffId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <>
      <PanelSection
        icon={<History className="size-4" aria-hidden />}
        title={<T k="staff.view.audit.title" />}
        subtitle={<T k="staff.view.audit.subtitle" />}
      />

      <PanelBody className="pb-0">
        <Feedback error={error} />
      </PanelBody>

      <RecordTable
        loading={loading}
        rowCount={rows.length}
        empty={<T k="staff.view.audit.empty" />}
        columns={[
          { header: <T k="staff.view.audit.column.when" />, width: 'w-44' },
          { header: <T k="staff.view.audit.column.actor" />, width: 'w-48' },
          { header: <T k="staff.view.audit.column.action" />, width: 'w-24' },
          { header: <T k="staff.view.audit.column.changes" /> },
        ]}
      >
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/70">
            <td className="px-5 py-2 text-xs text-slate-600">{formatDateTime(row.createdAt)}</td>
            <td className="px-2 py-2 text-xs text-slate-700">{row.actorLabel}</td>
            <td className="px-2 py-2">
              <Badge tone={ACTION_TONES[row.action] ?? 'neutral'}>
                {/* Uppercased in CSS: a translated word cannot be upper-cased safely in
                    every language. */}
                <span className="uppercase">
                  <TEnum k={AUDIT_ACTION_LABELS[row.action]} fallback={row.action} />
                </span>
              </Badge>
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              {/*
                Only the fields that moved. A full before-and-after snapshot buries the one
                field somebody is asking about, which is the point of the trail.
              */}
              {row.changes === null ? (
                '—'
              ) : (
                <span className="font-mono text-[11px]">
                  {Object.entries(row.changes)
                    .map(
                      ([field, change]) =>
                        `${field}: ${describeValue(change.before)} → ${describeValue(change.after)}`,
                    )
                    .join(' · ')}
                </span>
              )}
            </td>
          </tr>
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
        onRefresh={() => void load()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/**
 * A field this screen displays and does not write.
 *
 * Dashed and tinted rather than an input: a box that looks editable and refuses typing is
 * worse than plain text. Editing happens through `StaffFormDialog`, which is where the HR
 * boundary is already enforced.
 */
function ReadOnly({ value, mono = false }: { value: ReactNode; mono?: boolean }): ReactNode {
  const empty = value === null || value === undefined || value === '';
  return (
    <p
      className={cn(
        'min-h-[2.375rem] rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm break-words',
        mono && 'font-mono text-xs',
        empty ? 'text-slate-400' : 'text-slate-700',
      )}
    >
      {empty ? '—' : value}
    </p>
  );
}

/** Avatar with an icon fallback, so a missing upload is not a broken image. */
function Avatar({
  staffId,
  name,
  hasPhoto,
}: {
  staffId: number;
  name: string;
  hasPhoto: boolean;
}): ReactNode {
  const { t } = useLabels();
  const [failed, setFailed] = useState(false);

  if (!hasPhoto || failed) {
    return (
      <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-100">
        <User className="size-5 text-slate-400" aria-hidden />
      </div>
    );
  }

  return (
    <img
      src={`/api/profile/photo/${String(staffId)}`}
      alt={t('staff.view.avatarAlt', { name })}
      onError={() => setFailed(true)}
      className="size-11 shrink-0 rounded-lg border border-slate-200 object-cover"
    />
  );
}

/** Terminal reachability wording, shared with the dashboard and the device list. */
const DEVICE_STATUS_LABELS: Record<string, LabelKey> = {
  online: 'device.status.online',
  degraded: 'device.status.degraded',
  offline: 'device.status.offline',
  unknown: 'device.status.unknown',
};

const ROSTER_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  work: 'success',
  leave: 'warning',
  rest: 'neutral',
};

const LEAVE_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  cancelled: 'neutral',
};

/**
 * First and last day of a `YYYY-MM` value.
 *
 * Built as strings rather than through `Date`, because both ends land in `@db.Date` columns
 * and a `Date` round trip is where a month boundary shifts by a day for anybody west of the
 * server.
 */
function monthRange(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number);
  const safeYear = year ?? new Date().getUTCFullYear();
  const safeIndex = index ?? 1;
  const lastDay = new Date(Date.UTC(safeYear, safeIndex, 0)).getUTCDate();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return {
    from: `${String(safeYear)}-${pad(safeIndex)}-01`,
    to: `${String(safeYear)}-${pad(safeIndex)}-${pad(lastDay)}`,
  };
}

/** `getUTCFullYear`, not `getFullYear`: leave years are calendar years, not local ones. */
function yearOptions(): number[] {
  const current = new Date().getUTCFullYear();
  return [current + 1, current, current - 1, current - 2];
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
