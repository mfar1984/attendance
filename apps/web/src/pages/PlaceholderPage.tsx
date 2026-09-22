import type { LabelKey } from '@attendance/shared';
import { Construction } from 'lucide-react';
import type { ReactNode } from 'react';

import { T } from '../lib/translation';

/**
 * Stand-in for a route that is navigable but not built.
 *
 * Naming the route explicitly is better than an empty page, because it makes the
 * gap between the agreed structure and the implemented screens visible while
 * reviewing the shell.
 */
export function PlaceholderPage({
  titleKey,
  noteKey,
}: {
  titleKey: LabelKey;
  /**
   * What this screen will hold, when the route has one recorded.
   *
   * Twenty placeholders that read the same make the structure unreviewable: clicking
   * through says nothing the sidebar label did not already say. Naming the intent, and the
   * data it will read, is what lets somebody disagree with the plan before it is built.
   */
  noteKey?: LabelKey;
}): ReactNode {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <Construction className="size-8 text-slate-400" aria-hidden />
      <h2 className="mt-3 text-base font-semibold text-slate-700">
        <T k={titleKey} />
      </h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        <T k="shell.placeholder.body" />
      </p>
      {noteKey !== undefined && (
        <p className="mt-4 max-w-xl border-t border-slate-200 pt-4 text-sm text-slate-600">
          <T k={noteKey} />
        </p>
      )}
    </div>
  );
}
