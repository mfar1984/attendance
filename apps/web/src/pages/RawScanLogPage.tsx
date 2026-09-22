import { Image as ImageIcon, Lock } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, Feedback } from '../components/Dialog';
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
import { cn } from '../lib/cn';
import {
  EVENT_KIND_LABELS,
  EVENT_LABELS,
  MAJOR_LABELS,
  daysAgoIso,
  formatDateTime,
  lookupsApi,
  rawEventsApi,
  todayIso,
  type Lookups,
  type RawEventRow,
} from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * The terminal's own log, exactly as it was reported.
 *
 * Separate from Rekod Kehadiran on purpose. That screen shows what the engine derived;
 * this one shows what the hardware said, and it is never edited. When a staff member
 * disputes a computed record, this is the only thing that settles it, which is why
 * there is no edit or delete action here for anyone — including a Super Admin.
 */
export function RawScanLogPage(): ReactNode {
  const [rows, setRows] = useState<RawEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [major, setMajor] = useState('');
  const [arrivedVia, setArrivedVia] = useState<string | undefined>(undefined);
  const [employeeNo, setEmployeeNo] = useState('');
  const [from, setFrom] = useState(daysAgoIso(7));
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [picture, setPicture] = useState<RawEventRow | null>(null);
  const { t, tEnum } = useLabels();

  useEffect(() => {
    void lookupsApi
      .load()
      .then(setLookups)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await rawEventsApi.list({
        page,
        pageSize,
        ...(deviceId ? { deviceId: Number(deviceId) } : {}),
        ...(major ? { major: Number(major) } : {}),
        ...(arrivedVia !== undefined ? { arrivedVia: arrivedVia as 'push' | 'pull' } : {}),
        ...(employeeNo.trim() ? { employeeNo: employeeNo.trim() } : {}),
        from,
        to,
      });
      setRows(result.rows);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('rawlog.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, deviceId, major, arrivedVia, employeeNo, from, to, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const push = rows.filter((row) => row.arrivedVia === 'push').length;
  const pull = rows.length - push;

  return (
    <PanelCard title={<T k="rawlog.title" />} subtitle={<T k="rawlog.subtitle" />}>
      <PanelSection
        title={
          <T k="rawlog.count" vars={{ count: new Intl.NumberFormat('ms-MY').format(total) }} />
        }
        subtitle={<T k="rawlog.section.subtitle" />}
      />

      {/*
        Counted from the page in view rather than the whole range: the server does not
        facet this, and a chip claiming a total it did not measure would be a number
        that contradicts the table under it.
      */}
      <ChipBar
        active={arrivedVia}
        onChange={(id) => {
          setArrivedVia(id);
          setPage(1);
        }}
        chips={[
          { id: 'push', label: <T k="rawlog.chip.push" />, count: push, dot: 'bg-emerald-500' },
          { id: 'pull', label: <T k="rawlog.chip.pull" />, count: pull, dot: 'bg-sky-500' },
        ]}
      />

      <FilterRow
        search={employeeNo}
        onSearch={(value) => {
          setEmployeeNo(value);
          setPage(1);
        }}
        placeholder={t('rawlog.search')}
        dirty={
          employeeNo.length > 0 ||
          deviceId.length > 0 ||
          major.length > 0 ||
          arrivedVia !== undefined
        }
        onReset={() => {
          setEmployeeNo('');
          setDeviceId('');
          setMajor('');
          setArrivedVia(undefined);
          setPage(1);
        }}
      >
        <FacetSelect
          label={t('rawlog.filter.allDevices')}
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
        <FacetSelect
          label={t('rawlog.filter.allCategories')}
          value={major}
          onChange={(value) => {
            setMajor(value);
            setPage(1);
          }}
          // `<option>` cannot hold a node, so these resolve to plain text.
          options={Object.entries(MAJOR_LABELS).map(([value, key]) => ({
            value,
            label: tEnum(key, value),
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

      <PanelBody className="pb-0">
        <Feedback error={error} />
        <PanelNote icon={<Lock className="size-3.5" aria-hidden />}>
          {/*
            The emphasised clause is its own label spliced into the sentence, rather than the
            sentence being split around a `<strong>`. Splitting would fix where the bold part
            sits, and in another language it does not sit there.
          */}
          <T
            k="rawlog.immutable.note"
            vars={{
              emphasis: (
                <strong className="font-semibold">
                  <T k="rawlog.immutable" />
                </strong>
              ),
            }}
          />
        </PanelNote>
      </PanelBody>

      <div className="mt-3">
        <RecordTable
          loading={loading}
          rowCount={rows.length}
          empty={<T k="rawlog.empty" />}
          columns={[
            { header: <T k="rawlog.column.serial" />, width: 'w-24' },
            { header: <T k="rawlog.column.deviceTime" />, width: 'w-52' },
            { header: <T k="rawlog.column.event" /> },
            { header: <T k="rawlog.column.terminalId" />, width: 'w-28' },
            { header: <T k="rawlog.column.terminalName" /> },
            { header: <T k="rawlog.column.terminal" />, width: 'w-32' },
            { header: <T k="rawlog.column.punch" />, width: 'w-32' },
            { header: '', width: 'w-20', align: 'right' },
          ]}
        >
          {rows.map((row) => (
            <RawRow
              key={row.id}
              row={row}
              expanded={open === row.id}
              onToggle={() => setOpen(open === row.id ? null : row.id)}
              onPicture={() => setPicture(row)}
            />
          ))}
        </RecordTable>
      </div>

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

      {picture !== null && <PictureDialog event={picture} onClose={() => setPicture(null)} />}
    </PanelCard>
  );
}

function RawRow({
  row,
  expanded,
  onToggle,
  onPicture,
}: {
  row: RawEventRow;
  expanded: boolean;
  onToggle: () => void;
  onPicture: () => void;
}): ReactNode {
  const { t, tEnum } = useLabels();
  /**
   * The vendor's own event label, when the row carries vendor event codes.
   *
   * A protocol without a two-level code leaves both null, so this resolves to nothing and
   * the neutral classification below is rendered instead. Reading `EVENT_LABELS['null:null']`
   * would otherwise print the string `null/null` into the cell.
   */
  const nativeLabelKey =
    row.major === null || row.minor === null
      ? undefined
      : EVENT_LABELS[`${String(row.major)}:${String(row.minor)}`];
  const drifting = row.deviceDriftS !== null && Math.abs(row.deviceDriftS) > 30;

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          drifting && !expanded && 'bg-amber-50/40',
        )}
      >
        {/*
          The terminal's own sequence number, where its protocol has one. A callback
          protocol has none, and an em dash says that honestly rather than printing the
          word "null" or inventing a number this row does not have.
        */}
        <td className="px-5 py-2 font-mono text-xs tabular-nums text-slate-500">
          {row.serialNo === null ? <span className="text-slate-400">—</span> : `#${row.serialNo}`}
        </td>
        <td className="px-2 py-2 font-mono text-xs tabular-nums text-slate-600">
          {formatDateTime(row.eventTime)}
          {/*
            The clock error recorded when this arrived. Shown because a record taken
            while the terminal was minutes out cannot be judged without knowing that,
            and correcting the clock afterwards does not change what was stored.
          */}
          {drifting && (
            <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
              <T
                k="rawlog.row.drift"
                vars={{
                  drift: `${row.deviceDriftS! > 0 ? '+' : ''}${String(row.deviceDriftS)}`,
                }}
              />
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-slate-700">
          {/*
            Three tiers, narrowing as less is known. A recognised vendor code reads as itself;
            an unrecognised one falls back to the category name plus the number, which is still
            diagnosable; and a row with no vendor code at all reads as the driver's own verdict.
            The last tier is what keeps a terminal on a different protocol from rendering a
            blank cell where an ISAPI row shows a label.
          */}
          {nativeLabelKey !== undefined ? (
            <T k={nativeLabelKey} />
          ) : row.major !== null && row.minor !== null ? (
            `${tEnum(MAJOR_LABELS[row.major], String(row.major))}/${String(row.minor)}`
          ) : (
            <TEnum k={EVENT_KIND_LABELS[row.eventKind]} fallback={row.eventKind} />
          )}
          {row.major !== null && row.minor !== null && (
            <span className="ml-1.5 font-mono text-[10px] text-slate-400">
              {row.major}:{row.minor}
            </span>
          )}
        </td>
        <td className="px-2 py-2 font-mono text-xs text-slate-600">{row.employeeNo ?? '—'}</td>
        <td className="px-2 py-2 text-slate-600">
          {row.personName ?? <span className="text-slate-400">—</span>}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.device.name}</td>
        <td className="px-2 py-2">
          {row.punch === null ? (
            <span className="text-xs text-slate-400">
              <T k="rawlog.row.noPunch" />
            </span>
          ) : row.punch.suppressed ? (
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
              <T k="scan.suppressed" />
            </span>
          ) : (
            <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
              <T k="rawlog.row.recorded" />
            </span>
          )}
        </td>
        <td className="px-2 py-2 pr-4">
          <RowActions>
            {row.pictureUrl !== null && (
              <RowAction
                icon={<ImageIcon className="size-4" aria-hidden />}
                label={t('rawlog.row.picture')}
                tone="view"
                onClick={onPicture}
              />
            )}
            <ExpandButton expanded={expanded} onClick={onToggle} label={t('rawlog.row.expand')} />
          </RowActions>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={8} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="rawlog.detail.serial" />} value={row.serialNo ?? '—'} mono />
              {/*
                The dedup key, which every row has. Shown beside the sequence number rather
                than instead of it: on a protocol with no sequence this is the only stable
                identity the row has, and it is what the ingest log references when a push is
                rejected as a repeat.
              */}
              <Detail label={<T k="rawlog.detail.eventKey" />} value={row.eventKey} mono />
              <Detail
                label={<T k="rawlog.detail.eventCode" />}
                value={
                  row.major === null || row.minor === null
                    ? '—'
                    : `${String(row.major)}:${String(row.minor)}`
                }
                mono
              />
              <Detail label={<T k="rawlog.detail.verifyMode" />} value={row.verifyMode ?? '—'} />
              <Detail label={<T k="rawlog.detail.cardNo" />} value={row.cardNo ?? '—'} mono />
              <Detail
                label={<T k="rawlog.detail.door" />}
                value={row.doorNo === null ? '—' : String(row.doorNo)}
              />
              <Detail label={<T k="rawlog.detail.mask" />} value={row.maskWorn ?? '—'} />
              <Detail label={<T k="rawlog.detail.arrivedVia" />} value={row.arrivedVia} />
              <Detail
                label={<T k="rawlog.detail.receivedAt" />}
                value={formatDateTime(row.receivedAt)}
              />
              <Detail
                label={<T k="rawlog.detail.drift" />}
                value={
                  row.deviceDriftS === null ? (
                    <T k="rawlog.detail.drift.unmeasured" />
                  ) : (
                    `${String(row.deviceDriftS)}s`
                  )
                }
              />
              <Detail label={<T k="rawlog.detail.eventId" />} value={row.id} mono />
            </DetailGrid>

            {row.punch !== null && (
              <PanelNote tone={row.punch.suppressed ? 'info' : 'success'} className="mt-3">
                {row.punch.suppressed ? (
                  <T k="rawlog.detail.suppressed" vars={{ punch: row.punch.id }} />
                ) : (
                  <T
                    k="rawlog.detail.recorded"
                    vars={{ punch: row.punch.id, direction: row.punch.direction }}
                  />
                )}
              </PanelNote>
            )}

            {row.punch === null && row.employeeNo !== null && (
              <PanelNote tone="warn" className="mt-3">
                <T k="rawlog.detail.noPunchWarning" />
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Shows the snapshot the terminal captured.
 *
 * Streamed through the server because the image sits on the device behind Digest auth,
 * which a browser cannot satisfy, and proxying keeps the device credentials away from
 * the client entirely.
 */
function PictureDialog({
  event,
  onClose,
}: {
  event: RawEventRow;
  onClose: () => void;
}): ReactNode {
  const { t } = useLabels();
  /**
   * Falls back to the raw event id when the protocol has no sequence number.
   *
   * The title has to name the scan it is showing, and the row id is the identifier the
   * rest of the application already uses for a raw event — the exceptions screen labels
   * them the same way. Without this the heading would read "Snapshot #null".
   */
  const serial = event.serialNo ?? `#${event.id}`;

  return (
    <Dialog
      title={<T k="rawlog.picture.title" vars={{ serial }} />}
      titleText={t('rawlog.picture.title', { serial })}
      description={`${event.personName ?? event.employeeNo ?? '—'} · ${formatDateTime(event.eventTime)}`}
      onClose={onClose}
    >
      <img
        src={rawEventsApi.pictureUrl(event.id)}
        alt={t('rawlog.picture.alt', { serial })}
        className="w-full rounded-lg border border-slate-200 bg-slate-100"
      />
      <PanelNote className="mt-3">
        <T k="rawlog.picture.note" />
      </PanelNote>
    </Dialog>
  );
}
