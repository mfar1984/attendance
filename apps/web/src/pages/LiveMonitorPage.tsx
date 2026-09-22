import {
  CircleAlert,
  Fingerprint,
  IdCard,
  KeyRound,
  Radio,
  ScanFace,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  ChipBar,
  Detail,
  DetailGrid,
  ExpandButton,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  RecordTable,
} from '../components/RecordPanel';
import { StatTile } from '../components/ui';
import { cn } from '../lib/cn';
import { METHOD_LABELS } from '../lib/operations-api';
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
  problem: string | null;
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

/** Newest first, capped so a long shift cannot grow the list without bound. */
const MAX_ROWS = 200;

/**
 * Live view of scans as they happen.
 *
 * Fed by server-sent events. The browser reconnects on its own, and because the durable
 * record is already in the raw log, a gap in this feed costs nothing but a refresh.
 *
 * Rows are prepended rather than refetched so a scan appears the moment it is stored,
 * which is the whole point of the screen during a shift change.
 */
export function LiveMonitorPage(): ReactNode {
  const [scans, setScans] = useState<LiveScan[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/stream/scans', { withCredentials: true });

    source.addEventListener('ready', () => setConnected(true));

    source.addEventListener('scan', (event) => {
      try {
        const scan = JSON.parse((event as MessageEvent<string>).data) as LiveScan;
        setScans((current) => [scan, ...current].slice(0, MAX_ROWS));
        setLastEventAt(new Date());
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

  return (
    <PanelCard title={<T k="monitor.title" />} subtitle={<T k="monitor.subtitle" />}>
      <PanelSection
        title={<T k={connected ? 'monitor.connected' : 'monitor.disconnected'} />}
        subtitle={
          <T k={connected ? 'monitor.connected.hint' : 'monitor.disconnected.hint'} />
        }
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
            {lastEventAt === null ? (
              <T k="monitor.waiting" />
            ) : (
              <T
                k="monitor.lastAt"
                vars={{ time: lastEventAt.toLocaleTimeString('ms-MY', { hour12: false }) }}
              />
            )}
          </span>
        }
      />

      <PanelBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label={<T k="monitor.stat.accepted" />}
            value={String(accepted)}
            hint={<T k="monitor.stat.accepted.hint" />}
            tone="success"
          />
          {/*
            Shown rather than hidden. The terminal emits several scans for one person
            seconds apart; the engine keeps one and flags the rest, and hiding that
            would make this view disagree with the raw log.
          */}
          <StatTile
            label={<T k="monitor.stat.suppressed" />}
            value={String(suppressed)}
            hint={<T k="monitor.stat.suppressed.hint" />}
          />
          <StatTile
            label={<T k="monitor.stat.problems" />}
            value={String(problems)}
            hint={<T k="monitor.stat.problems.hint" />}
            tone={problems > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {!connected && (
          <PanelNote tone="warn" icon={<WifiOff className="size-3.5" aria-hidden />}>
            <T k="monitor.offline.note" />
          </PanelNote>
        )}
      </PanelBody>

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

      {scans.length === 0 ? (
        <div className="py-16 text-center">
          <Radio className="mx-auto size-6 text-slate-300" aria-hidden />
          <p className="mt-2 text-sm text-slate-500">
            <T k="monitor.idle" />
          </p>
        </div>
      ) : (
        <div
          // A live region so a screen reader announces arrivals instead of leaving
          // them silent.
          aria-live="polite"
          aria-relevant="additions"
          className="max-h-[36rem] overflow-y-auto"
        >
          <RecordTable
            loading={false}
            rowCount={filtered.length}
            empty={<T k="monitor.empty" />}
            columns={[
              { header: <T k="monitor.column.time" />, width: 'w-24' },
              { header: <T k="monitor.column.staff" /> },
              { header: <T k="monitor.column.terminal" />, width: 'w-40' },
              { header: <T k="monitor.column.method" />, width: 'w-28' },
              { header: <T k="monitor.column.outcome" />, width: 'w-44' },
              { header: '', width: 'w-10' },
            ]}
          >
            {filtered.map((scan) => (
              /*
                Keyed on the dedup key, not the sequence number. A callback protocol has no
                sequence, so every scan from one of those terminals arrived with the same
                null and React collapsed them into a single row that kept overwriting itself.
              */
              <ScanRow
                key={`${String(scan.deviceId)}-${scan.eventKey}`}
                scan={scan}
                expanded={open === scan.rawEventId}
                onToggle={() =>
                  setOpen(open === scan.rawEventId ? null : scan.rawEventId)
                }
              />
            ))}
          </RecordTable>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <p className="text-xs text-slate-500">
          <T
            k="monitor.footer.showing"
            vars={{ shown: filtered.length, total: scans.length }}
          />
          {scans.length >= MAX_ROWS && (
            <T k="monitor.footer.capped" vars={{ max: MAX_ROWS }} />
          )}
        </p>
        <p className="text-xs text-slate-400">
          <T k="monitor.footer.note" />
        </p>
      </div>
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
  const time = new Date(scan.at).toLocaleTimeString('ms-MY', { hour12: false });

  return (
    <>
      <tr
        className={cn(
          'border-b border-slate-100',
          expanded ? 'bg-slate-50' : 'hover:bg-slate-50/70',
          scan.problem !== null && !expanded && 'bg-amber-50/40',
        )}
      >
        <td className="px-5 py-2 font-mono text-xs tabular-nums text-slate-500">{time}</td>
        <td className="px-2 py-2">
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
              <span className="block text-slate-800">{scan.name}</span>
              <span className="block font-mono text-[11px] text-slate-400">{scan.employeeNo}</span>
            </>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{scan.deviceName}</td>
        <td className="px-2 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <Icon
              className={cn(
                'size-3.5',
                scan.problem === null ? 'text-slate-400' : 'text-amber-500',
              )}
              aria-hidden
            />
            <TEnum k={METHOD_LABELS[scan.method]} fallback={scan.method} />
          </span>
        </td>
        <td className="px-2 py-2">
          {/*
            Upper case on the problem badge comes from the class, not from the string.

            `.toUpperCase()` on a sentence is not safe in every language — Turkish dotless i and
            German eszett both change letter or length — and this value is prose the server wrote,
            not a code somebody typed.
          */}
          {scan.problem !== null ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase">
              <CircleAlert className="size-3" aria-hidden />
              {scan.problem}
            </span>
          ) : scan.suppressed ? (
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
              <T k="scan.suppressed" />
            </span>
          ) : (
            <span className="inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
              {scan.direction === 'in' ? (
                <T k="scan.in" />
              ) : scan.direction === 'out' ? (
                <T k="scan.out" />
              ) : (
                <T k="monitor.row.recorded" />
              )}
            </span>
          )}
        </td>
        <td className="w-10 pr-4">
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
              <Detail label={<T k="monitor.detail.direction" />} value={scan.direction} />
            </DetailGrid>

            {scan.problem !== null && (
              <PanelNote tone="warn" className="mt-3">
                {scan.employeeNo !== null && scan.staffId === null ? (
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
