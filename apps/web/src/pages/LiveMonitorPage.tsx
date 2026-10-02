import type { LabelKey } from '@attendance/shared';
import { CircleAlert, Fingerprint, IdCard, KeyRound, Radio, ScanFace, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Feedback } from '../components/Dialog';
import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  PanelBody,
  PanelCard,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
} from '../components/RecordPanel';
import { Badge } from '../components/ui';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { METHOD_LABELS, formatTime } from '../lib/operations-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Mirrors `LiveScan` in `apps/server/src/events/bus.ts`.
 *
 * A hand-kept copy, because the payload crosses an SSE boundary and there is no shared
 * type to import. That means `tsc` cannot catch a drift between the two — so a change to
 * the server's shape has to be made here in the same commit, and the fields below are
 * ordered identically to make the comparison possible by eye.
 */
interface LiveScan {
  punchId: number | null;
  rawEventId: string;
  /** Dedup identity, and what rows are keyed on. Always present. */
  eventKey: string;
  /** The terminal's own sequence. Null where the protocol has none. */
  serialNo: string | null;
  at: string;
  deviceId: number;
  deviceName: string;
  staffId: number | null;
  employeeNo: string | null;
  name: string | null;
  method: string;
  direction: string;
  suppressed: boolean;
  /** A code the server chose; the wording is this screen's. */
  problem: string | null;
}

/** What `/api/stream/scans/today` answers. */
interface TodayScans {
  /** True when today goes back further than the cap, so the list is the newest part of it. */
  truncated: boolean;
  scans: LiveScan[];
}

/**
 * One icon per credential.
 *
 * `password` is here because a PIN is an ordinary way to authenticate on some terminals
 * rather than a rare fallback, and a row with no icon reads as a row whose method failed
 * to load. An unmapped method still renders its label; only the glyph is absent.
 */
const METHOD_ICONS: Record<string, typeof ScanFace> = {
  face: ScanFace,
  fingerprint: Fingerprint,
  card: IdCard,
  password: KeyRound,
};

/** Why a scan did not become anybody's punch. Keyed on the code `publishScan` sends. */
const PROBLEM_LABELS: Record<string, LabelKey> = {
  unrecognisedFace: 'monitor.problem.unrecognisedFace',
  unmappedId: 'monitor.problem.unmappedId',
};

const DIRECTION_LABELS: Record<string, LabelKey> = {
  in: 'scan.in',
  out: 'scan.out',
};

/** Newest first, capped so a long shift cannot grow the list without bound. */
const MAX_ROWS = 200;

const keyOf = (scan: LiveScan): string => `${String(scan.deviceId)}-${scan.eventKey}`;

/**
 * Today's stored scans and the live ones, as one list.
 *
 * Keyed on the dedup key rather than the sequence number: a callback protocol has no sequence,
 * so every scan from one of those terminals would collapse into a single row. Ordered on the
 * instant the scan happened, so a scan the reconcile pull delivered a minute late lands where it
 * belongs instead of on top as though it had just occurred.
 */
function merge(current: LiveScan[], incoming: LiveScan[]): LiveScan[] {
  const byKey = new Map<string, LiveScan>();
  for (const scan of [...current, ...incoming]) {
    if (!byKey.has(keyOf(scan))) byKey.set(keyOf(scan), scan);
  }
  return [...byKey.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ROWS);
}

/**
 * Today's scans, and new ones as they happen.
 *
 * Opens with what today already holds, then prepends from server-sent events. It used to show
 * only what arrived while the page was open, so a scan made before opening it — which is how
 * anybody tests a terminal — was nowhere on a screen called today's monitor, and the empty table
 * read as the scan having been lost. The same read runs again whenever the stream reconnects, so a
 * dropped connection leaves no gap either.
 */
export function LiveMonitorPage(): ReactNode {
  const [scans, setScans] = useState<LiveScan[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const { t } = useLabels();

  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      const reply = await api.get<TodayScans>('/api/stream/scans/today');
      setScans((current) => merge(current, reply.scans));
      setTruncated(reply.truncated);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('monitor.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  /*
    Held in a ref so the stream is opened once. As a dependency of the effect below, a new
    `loadToday` — the wording arriving changes `t` — would tear the connection down and open
    another.
  */
  const loadRef = useRef(loadToday);
  useEffect(() => {
    loadRef.current = loadToday;
  }, [loadToday]);

  useEffect(() => {
    const source = new EventSource('/api/stream/scans', { withCredentials: true });

    // `ready` is sent on every connection, the first and each reconnect, so this also fills
    // whatever a dropped connection missed.
    source.addEventListener('ready', () => {
      setConnected(true);
      void loadRef.current();
    });

    source.addEventListener('scan', (event) => {
      try {
        const scan = JSON.parse((event as MessageEvent<string>).data) as LiveScan;
        setScans((current) => merge([scan], current));
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });

    // EventSource reconnects by itself; this only reflects the state so the operator
    // knows whether silence means "nobody scanned" or "feed is down".
    source.onerror = () => setConnected(false);
    source.onopen = () => setConnected(true);

    return () => source.close();
  }, []);

  const accepted = scans.filter((scan) => scan.punchId !== null && !scan.suppressed).length;
  const suppressed = scans.filter((scan) => scan.suppressed).length;
  const problems = scans.filter((scan) => scan.problem !== null).length;

  const filtered = scans.filter((scan) => {
    if (outcome === 'accepted') return scan.punchId !== null && !scan.suppressed;
    if (outcome === 'suppressed') return scan.suppressed;
    if (outcome === 'problem') return scan.problem !== null;
    return true;
  });

  // Today goes back further than the list, or live scans have pushed the oldest off it.
  const capped = truncated || scans.length >= MAX_ROWS;
  const newest = scans[0] ?? null;

  return (
    <PanelCard title={<T k="monitor.title" />} subtitle={<T k="monitor.subtitle" />}>
      <PanelSection
        title={<T k={capped ? 'monitor.count.recent' : 'monitor.count'} vars={{ count: scans.length }} />}
        subtitle={<T k={connected ? 'monitor.connected.hint' : 'monitor.disconnected.hint'} />}
        action={
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
            )}
          >
            {connected ? (
              <Radio className="size-3.5 animate-pulse" aria-hidden />
            ) : (
              <WifiOff className="size-3.5" aria-hidden />
            )}
            <T k={connected ? 'monitor.connected' : 'monitor.disconnected'} />
            {connected && (
              <>
                {' · '}
                {newest === null ? (
                  <T k="monitor.waiting" />
                ) : (
                  <T k="monitor.lastAt" vars={{ time: formatTime(newest.at) }} />
                )}
              </>
            )}
          </span>
        }
      />

      <ChipBar
        active={outcome}
        onChange={setOutcome}
        chips={[
          {
            id: 'accepted',
            label: <T k="monitor.chip.accepted" />,
            count: accepted,
            dot: 'bg-emerald-500',
          },
          /*
            Shown rather than hidden. The terminal emits several scans for one person seconds
            apart; the engine keeps one and flags the rest, and hiding that would make this view
            disagree with the raw log.
          */
          {
            id: 'suppressed',
            label: <T k="monitor.chip.suppressed" />,
            count: suppressed,
            dot: 'bg-slate-400',
          },
          {
            id: 'problem',
            label: <T k="monitor.chip.problem" />,
            count: problems,
            dot: 'bg-amber-500',
          },
        ]}
      />

      {error !== null && (
        <PanelBody className="pb-0">
          <Feedback error={error} />
        </PanelBody>
      )}

      <div
        // A live region so a screen reader announces arrivals instead of leaving them silent.
        aria-live="polite"
        aria-relevant="additions"
      >
        <RecordTable
          framed
          loading={loading}
          rowCount={filtered.length}
          empty={
            scans.length === 0 ? (
              <span className="flex flex-col items-center gap-2">
                <Radio className="size-6 text-slate-300" aria-hidden />
                <T k="monitor.idle" />
              </span>
            ) : (
              <T k="monitor.empty" />
            )
          }
          columns={[
            { header: <T k="monitor.column.time" />, width: 'w-24' },
            { header: <T k="monitor.column.staff" /> },
            { header: <T k="monitor.column.terminal" />, width: 'w-40' },
            { header: <T k="monitor.column.method" />, width: 'w-32' },
            { header: <T k="monitor.column.outcome" />, width: 'w-48' },
            { header: '', width: 'w-12' },
          ]}
        >
          {filtered.map((scan) => (
            <ScanRow
              key={keyOf(scan)}
              scan={scan}
              expanded={open === keyOf(scan)}
              onToggle={() => setOpen(open === keyOf(scan) ? null : keyOf(scan))}
            />
          ))}
        </RecordTable>
      </div>

      <PanelFooter
        shown={filtered.length}
        total={scans.length}
        page={1}
        pageSize={MAX_ROWS}
        pageSizes={[MAX_ROWS]}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void loadToday()}
      />
    </PanelCard>
  );
}

function ScanRow({
  scan,
  expanded,
  onToggle,
}: {
  scan: LiveScan;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const { t } = useLabels();
  const Icon = METHOD_ICONS[scan.method] ?? ScanFace;
  const directionKey = DIRECTION_LABELS[scan.direction];

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          scan.problem !== null && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2.5 font-mono text-xs tabular-nums text-slate-500">
          {formatTime(scan.at)}
        </td>
        <td className="px-2 py-2.5">
          {scan.name === null ? (
            <span className="text-sm text-slate-400 italic">
              {scan.employeeNo === null ? (
                <T k="monitor.row.unknown" />
              ) : (
                <T k="monitor.row.unmapped" vars={{ employeeNo: scan.employeeNo }} />
              )}
            </span>
          ) : (
            <>
              <span className="block font-medium text-slate-800">{scan.name}</span>
              <span className="block font-mono text-[11px] text-slate-400">{scan.employeeNo}</span>
            </>
          )}
        </td>
        <td className="px-2 py-2.5 text-xs text-slate-600">{scan.deviceName}</td>
        <td className="px-2 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <Icon
              className={cn('size-3.5', scan.problem === null ? 'text-slate-400' : 'text-amber-500')}
              aria-hidden
            />
            <TEnum k={METHOD_LABELS[scan.method]} fallback={scan.method} />
          </span>
        </td>
        <td className="px-2 py-2.5">
          {/* Uppercased by the badge's class: a translated word cannot be upper-cased safely. */}
          {scan.problem !== null ? (
            <Badge tone="warning" className="uppercase">
              <CircleAlert className="size-3" aria-hidden />
              <TEnum k={PROBLEM_LABELS[scan.problem]} fallback={scan.problem} />
            </Badge>
          ) : scan.suppressed ? (
            <Badge tone="neutral" className="uppercase">
              <T k="scan.suppressed" />
            </Badge>
          ) : (
            <Badge tone="success" className="uppercase">
              <T k={directionKey ?? 'monitor.row.recorded'} />
            </Badge>
          )}
        </td>
        <td className="px-2 py-2.5 pr-4">
          <ExpandButton expanded={expanded} onClick={onToggle} label={t('monitor.row.expand')} />
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={6} className="px-5 py-3">
            <DetailGrid>
              <Detail label={<T k="monitor.detail.fullTime" />} value={scan.at} mono />
              <Detail label={<T k="monitor.detail.serial" />} value={scan.serialNo ?? '—'} mono />
              <Detail label={<T k="monitor.detail.eventKey" />} value={scan.eventKey} mono />
              <Detail label={<T k="monitor.detail.rawEventId" />} value={scan.rawEventId} mono />
              <Detail
                label={<T k="monitor.detail.terminalId" />}
                value={scan.employeeNo ?? '—'}
                mono
              />
              <Detail
                label={<T k="monitor.detail.punch" />}
                value={
                  scan.punchId === null ? (
                    <T k="monitor.detail.punch.none" />
                  ) : (
                    `#${String(scan.punchId)}`
                  )
                }
                mono
              />
              <Detail
                label={<T k="monitor.detail.direction" />}
                value={<T k={directionKey ?? 'scan.undecided'} />}
              />
            </DetailGrid>

            {scan.problem !== null && (
              <PanelNote tone="warn" className="mt-3">
                {scan.problem === 'unmappedId' && scan.employeeNo !== null ? (
                  <T
                    k="monitor.detail.unmappedWarning"
                    vars={{ employeeNo: scan.employeeNo, device: scan.deviceName }}
                  />
                ) : (
                  <T k="monitor.detail.noPunchWarning" />
                )}
              </PanelNote>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
