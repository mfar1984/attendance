import { Loader2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { T, useLabels } from '../lib/translation';
import { Button, Field } from './ui';

/** One member of staff as the per-module search endpoints return them. */
export interface PickedStaff {
  id: number;
  employeeNo: string;
  fullName: string;
  department: { name: string } | null;
}

/**
 * The two-stage name picker, for a form that names one member of staff.
 *
 * Stage one is a search box over a list filtered on the server. Stage two is the chosen person on
 * a strip with a button to change them — and the caller renders the rest of its form only once
 * there is somebody to render it for, because the facts that depend on the person (a leave
 * balance, the hours the engine measured) cannot be shown before then. A `<select>` over this
 * directory would be five thousand options and a quarter of a megabyte with no way to search it.
 *
 * The same markup Leave and Claims carry inline, lifted out for the modules that came after them
 * so the copies cannot drift. `search` is the module's own endpoint, one per module, because the
 * gate differs: whoever files overtime is not necessarily whoever files leave.
 */
export function StaffPicker({
  value,
  onChange,
  search,
  hint,
}: {
  value: PickedStaff | null;
  onChange: (staff: PickedStaff | null) => void;
  search: (query: string) => Promise<PickedStaff[]>;
  /** What choosing somebody loads, or how the list is filtered. Module-specific. */
  hint: ReactNode;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PickedStaff[]>([]);
  const [searching, setSearching] = useState(false);
  const { t } = useLabels();

  /*
   * Held in a ref so the search effect does not depend on it. A caller passing an inline arrow
   * hands over a new function on every render, and as a dependency each one would restart the
   * debounce — a search that refires every 250 ms for as long as the dialog stays open.
   */
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  // Same debounce and the same shape as the leave form's picker.
  useEffect(() => {
    if (value !== null) return;
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchRef
        .current(query)
        // A slower answer to an older query must not replace the list for the current one.
        .then((rows) => {
          if (!cancelled) setCandidates(rows);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, value]);

  if (value !== null) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <UserRound className="size-4 text-slate-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{value.fullName}</p>
          <p className="font-mono text-xs text-slate-500">
            {value.employeeNo}
            {value.department !== null && ` · ${value.department.name}`}
          </p>
        </div>
        <Button variant="ghost" onClick={() => onChange(null)}>
          <T k="leave.new.change" />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Field
        label={<T k="leave.new.searchStaff" />}
        hint={hint}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('leave.new.searchStaff.placeholder')}
        autoFocus
      />

      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        {searching && candidates.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-slate-400" aria-label={t('app.loading')} />
          </div>
        ) : candidates.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            <T k="leave.new.noMatch" />
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => onChange(candidate)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <UserRound className="size-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {candidate.fullName}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-500">
                      {candidate.employeeNo}
                      {candidate.department !== null && ` · ${candidate.department.name}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
