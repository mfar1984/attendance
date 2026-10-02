import { CircleCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from '../components/Dialog';
import {
  ChipBar,
  DateBox,
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
  RecordTable,
  RowAction,
  RowActions,
} from '../components/RecordPanel';
import { Badge, TextArea } from '../components/ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  EXCEPTION_LABELS,
  daysAgoIso,
  exceptionsApi,
  formatDateOnly,
  formatDateTime,
  lookupsApi,
  todayIso,
  type ExceptionRow,
  type Lookups,
} from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

const SCREEN = 'attendance.exceptions';

/** Chip order, fixed: the ones that cost somebody a recorded day first. */
const KIND_ORDER = [
  'unknown_employee',
  'missing_check_out',
  'missing_check_in',
  'unrecognised_face',
  'clock_drift',
  'outside_roster',
  'outside_geofence',
  'duplicate_scan',
];

const KIND_DOT: Record<string, string> = {
  missing_check_out: 'bg-amber-500',
  missing_check_in: 'bg-amber-500',
  duplicate_scan: 'bg-slate-400',
  unrecognised_face: 'bg-orange-500',
  unknown_employee: 'bg-rose-500',
  outside_roster: 'bg-fuchsia-500',
  clock_drift: 'bg-rose-500',
  outside_geofence: 'bg-orange-500',
};

/**
 * The queue of things the engine could not resolve on its own.
 *
 * This is the screen an HR clerk opens every morning. It is a first-class page rather
 * than a filter on the attendance table, because a hidden filter is exactly how these
 * get missed until payroll day.
 */
export function ExceptionsPage(): ReactNode {
  const { t } = useLabels();
  const { can } = useAuth();
  // The default window, kept so Reset can return to it and `dirty` can tell when it has moved.
  const [defaults] = useState(() => ({ from: daysAgoIso(30), to: todayIso() }));
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [openTotal, setOpenTotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const [resolved, setResolved] = useState<'open' | 'resolved' | 'all'>('open');
  const [deviceId, setDeviceId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState<ExceptionRow | null>(null);

  const mayResolve = can(SCREEN, 'approve');

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await exceptionsApi.list({
        page,
        pageSize,
        ...(kind !== undefined ? { kind } : {}),
        ...(resolved === 'all' ? {} : { resolved: resolved === 'resolved' }),
        ...(deviceId ? { deviceId: Number(deviceId) } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        from,
        to,
      });
      setRows(result.rows);
      setTotal(result.total);
      setByKind(result.byKind);
      setOpenTotal(result.openTotal);
      setGeneratedAt(result.generatedAt);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('exceptions.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, kind, resolved, deviceId, search, from, to, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <PanelCard title={<T k="exceptions.title" />} subtitle={<T k="exceptions.subtitle" />}>
      <PanelSection
        title={
          openTotal === 0 ? (
            <T k="exceptions.none" />
          ) : (
            <T k="exceptions.outstanding" vars={{ count: openTotal }} />
          )
        }
        subtitle={<T k="exceptions.section.subtitle" />}
      />

      {/*
        Every kind, in a fixed order. The bar used to list only kinds with something open, sorted
        by size, so it changed length and order between mornings and a kind could not be found in
        the same place twice.
      */}
      <ChipBar
        active={kind}
        onChange={(id) => {
          setKind(id);
          setPage(1);
        }}
        chips={KIND_ORDER.map((key) => ({
          id: key,
          label: <TEnum k={EXCEPTION_LABELS[key]} fallback={key} />,
          count: byKind[key] ?? 0,
          dot: KIND_DOT[key] ?? 'bg-slate-400',
        }))}
      />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('exceptions.search')}
        dirty={
          search.length > 0 ||
          kind !== undefined ||
          resolved !== 'open' ||
          deviceId !== '' ||
          from !== defaults.from ||
          to !== defaults.to
        }
        onReset={() => {
          setSearch('');
          setKind(undefined);
          setResolved('open');
          setDeviceId('');
          setFrom(defaults.from);
          setTo(defaults.to);
          setPage(1);
        }}
      >
        {/* `FacetSelect` and `DateBox` labels land in `<option>` and `aria-label`, which are
            strings by definition, so these go through `t()` rather than `<T>`. */}
        <FacetSelect
          label={t('exceptions.filter.allStatuses')}
          value={resolved === 'all' ? '' : resolved}
          onChange={(value) => {
            setResolved(value === '' ? 'all' : (value as 'open' | 'resolved'));
            setPage(1);
          }}
          options={[
            { value: 'open', label: t('exceptions.filter.open') },
            { value: 'resolved', label: t('exceptions.filter.resolved') },
          ]}
        />
        <FacetSelect
          label={t('exceptions.filter.allTerminals')}
          value={deviceId}
          onChange={(value) => {
            setDeviceId(value);
            setPage(1);
          }}
          options={(lookups?.devices ?? []).map((device) => ({
            value: String(device.id),
            label: device.name,
          }))}
        />
        <DateBox
          label={t('filter.from')}
          value={from}
          onChange={(value) => {
            setFrom(value);
            setPage(1);
          }}
        />
        <DateBox
          label={t('filter.to')}
          value={to}
          onChange={(value) => {
            setTo(value);
            setPage(1);
          }}
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
        empty={<T k="exceptions.empty" />}
        columns={[
          { header: <T k="exceptions.column.kind" />, width: 'w-52' },
          { header: <T k="exceptions.column.staff" /> },
          { header: <T k="exceptions.column.terminal" />, width: 'w-32' },
          { header: <T k="exceptions.column.occurred" />, width: 'w-40' },
          { header: <T k="exceptions.column.detail" /> },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="panel.column.actions" />, width: 'w-24', align: 'right' },
        ]}
      >
        {rows.map((row) => (
          <ExceptionRowView
            key={row.id}
            row={row}
            mayResolve={mayResolve}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            onResolve={() => setActive(row)}
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

      {active !== null && (
        <ResolveDialog
          target={active}
          onClose={() => setActive(null)}
          onDone={async (message) => {
            setActive(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </PanelCard>
  );
}

function ExceptionRowView({
  row,
  mayResolve,
  expanded,
  onToggle,
  onResolve,
}: {
  row: ExceptionRow;
  mayResolve: boolean;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
}): ReactNode {
  const { t } = useLabels();
  const outstanding = row.resolvedAt === null;

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          outstanding && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2.5">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', KIND_DOT[row.kind] ?? 'bg-slate-400')}
              aria-hidden
            />
            <span className="text-xs font-medium text-slate-700">
              <TEnum k={EXCEPTION_LABELS[row.kind]} fallback={row.kind} />
            </span>
          </span>
        </td>
        <td className="px-2 py-2.5">
          {row.staff === null ? (
            <span className="text-xs text-slate-400 italic">
              <T k="exceptions.row.unmapped" />
            </span>
          ) : (
            <>
              <span className="block font-medium text-slate-800">{row.staff.fullName}</span>
              <span className="block font-mono text-[11px] text-slate-400">
                {row.staff.employeeNo}
              </span>
            </>
          )}
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-600">{row.deviceName ?? '—'}</td>
        <td className="px-2 py-2.5 text-xs whitespace-nowrap tabular-nums text-slate-600">
          {formatDateTime(row.occurredAt)}
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-500">
          <span className="line-clamp-1">{row.detail ?? '—'}</span>
        </td>
        <td className="px-2 py-2.5">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          <Badge tone={outstanding ? 'warning' : 'success'} className="uppercase">
            <T k={outstanding ? 'exceptions.status.open' : 'exceptions.row.done'} />
          </Badge>
        </td>
        <td className="px-2 py-2.5 pr-4">
          <RowActions>
            {outstanding && mayResolve && (
              <RowAction
                icon={<CircleCheck className="size-4" aria-hidden />}
                label={t('exceptions.row.resolve')}
                tone="success"
                onClick={onResolve}
              />
            )}
            <ExpandButton
              expanded={expanded}
              onClick={onToggle}
              label={t('exceptions.row.expand')}
            />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={7} className="px-5 py-3">
            <DetailGrid>
              <Detail
                label={<T k="exceptions.detail.kind" />}
                value={<TEnum k={EXCEPTION_LABELS[row.kind]} fallback={row.kind} />}
              />
              <Detail label={<T k="exceptions.detail.internalCode" />} value={row.kind} mono />
              <Detail
                label={<T k="exceptions.detail.workDate" />}
                value={formatDateOnly(row.workDate)}
              />
              <Detail
                label={<T k="exceptions.detail.occurred" />}
                value={formatDateTime(row.occurredAt)}
              />
              <Detail
                label={<T k="exceptions.detail.terminal" />}
                value={row.deviceName ?? '—'}
              />
              <Detail
                label={<T k="exceptions.detail.rawEvent" />}
                value={
                  row.rawEventId === null ? (
                    <T k="exceptions.detail.rawEvent.none" />
                  ) : (
                    `#${row.rawEventId}`
                  )
                }
                mono
              />
            </DetailGrid>

            {row.detail !== null && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  <T k="exceptions.detail.heading" />
                </p>
                <p className="mt-1 text-sm break-words text-slate-700">{row.detail}</p>
              </div>
            )}

            {row.resolvedAt !== null && (
              <PanelNote tone="success" className="mt-3">
                <T
                  k="exceptions.detail.resolvedAt"
                  vars={{
                    when: formatDateTime(row.resolvedAt),
                    note: row.resolutionNote ?? t('exceptions.detail.noReason'),
                  }}
                />
              </PanelNote>
            )}

            {row.kind === 'unknown_employee' && outstanding && (
              <PanelNote tone="warn" className="mt-3">
                <T k="exceptions.detail.unmappedWarning" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Closes an exception with a written reason.
 *
 * The note is mandatory. An exception closed without one leaves no trace of why, and
 * these rows are what settle a dispute over somebody's pay months later.
 */
function ResolveDialog({
  target,
  onClose,
  onDone,
}: {
  target: ExceptionRow;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, tEnum } = useLabels();

  const kindText = tEnum(EXCEPTION_LABELS[target.kind], target.kind);
  const who = target.staff?.fullName ?? target.deviceName ?? '—';

  const presets = [
    t('exceptions.resolve.preset.forgotOut'),
    t('exceptions.resolve.preset.fieldWork'),
    t('exceptions.resolve.preset.notStaff'),
    t('exceptions.resolve.preset.fixedManually'),
  ];

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await exceptionsApi.resolve(target.id, note.trim());
      await onDone(t('exceptions.resolve.done', { kind: kindText, name: who }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('exceptions.resolve.error'));
      setBusy(false);
    }
  }

  const tooShort = note.trim().length < 3;

  return (
    <Dialog
      title={<TEnum k={EXCEPTION_LABELS[target.kind]} fallback={target.kind} />}
      titleText={kindText}
      description={`${who} · ${formatDateTime(target.occurredAt)}`}
      width="lg"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {target.detail !== null && <PanelNote>{target.detail}</PanelNote>}

        <TextArea
          label={<T k="exceptions.resolve.note" />}
          hint={<T k="exceptions.resolve.placeholder" />}
          autoFocus
          rows={3}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="flex flex-wrap gap-1.5 pb-2">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setNote(preset)}
              className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {preset}
            </button>
          ))}
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={tooShort}
          {...(tooShort ? { submitTitle: t('exceptions.resolve.placeholder') } : {})}
          submitLabel={<T k="exceptions.resolve.submit" />}
        />
      </div>
    </Dialog>
  );
}
