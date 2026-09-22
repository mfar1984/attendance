import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { T, useLabels } from '../lib/translation';
import { Button } from './ui';

/**
 * Modal shell.
 *
 * Escape closes and focus moves into the panel on open, because a dialog that
 * leaves focus behind it on the page is one a keyboard user cannot reach without
 * tabbing through everything underneath.
 */
export function Dialog({
  title,
  titleText,
  description,
  onClose,
  children,
  width = 'md',
}: {
  /**
   * A node for the visible heading, so it can carry its label stamp.
   *
   * `aria-label` on the panel needs plain text, which is what `titleText` is for. Without
   * it the accessible name would be whatever React flattens the node to.
   */
  title: ReactNode;
  /** Plain text for the accessible name, where `title` is not a bare string. */
  titleText?: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /**
   * `2xl` exists for forms with a multi-column row of controls in them.
   *
   * At `xl` the leave type form's five-across row still wrapped its longest field label onto two
   * lines, which left the row's baselines ragged — the thing that reads as untidy is the unevenness,
   * not the density. A row of five needs the width the row implies.
   *
   * `3xl` is for a form that holds a repeating block rather than a row of fields. The claim form is
   * the case: each line is a four-across grid plus its own attachment strip, and up to fifty of them
   * stack. At `2xl` each line's fields are narrow enough that a description is read a few words at a
   * time, and the reason the width matters is that somebody is comparing one line against the next.
   */
  width?: 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}): ReactNode {
  const { t } = useLabels();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    /*
      Centred rather than pinned to the top. The panel is capped at the viewport
      height and scrolls its own body, so centring cannot clip a tall form the way
      `items-center` on a scrolling overlay would.
    */
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={titleText ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl',
          'border border-slate-200 bg-white shadow-xl focus:outline-none',
          width === 'md' && 'max-w-md',
          width === 'lg' && 'max-w-2xl',
          width === 'xl' && 'max-w-4xl',
          width === '2xl' && 'max-w-5xl',
          width === '3xl' && 'max-w-6xl',
        )}
      >
        {/* The rule under the title is what makes the header read as a header
            rather than as the first row of the form. */}
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dialog.close')}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function DialogFooter({
  onClose,
  onSubmit,
  busy,
  disabled,
  submitLabel,
  closeLabel,
}: {
  onClose: () => void;
  onSubmit?: () => void;
  busy?: boolean;
  disabled?: boolean;
  /**
   * Nodes, so a screen can pass its own labelled wording.
   *
   * Defaulted here rather than in the signature so the fallbacks come from the registry:
   * a default argument would be a literal, and literals are the thing being removed.
   */
  submitLabel?: ReactNode;
  closeLabel?: ReactNode;
}): ReactNode {
  return (
    /*
      Full-bleed and sticky to the bottom of the scrolling body. The negative margins
      cancel the body padding so the bar meets the panel edge, and `sticky` keeps the
      action row reachable on a form long enough to scroll — the submit button being
      below the fold is how a half-filled record gets abandoned.
    */
    <div
      className={cn(
        'sticky bottom-0 -mx-4 -mb-4 mt-4 flex justify-end gap-2 rounded-b-xl',
        'border-t border-slate-200 bg-slate-50 px-4 py-3',
      )}
    >
      <Button variant="ghost" onClick={onClose} disabled={busy === true}>
        {closeLabel ?? <T k="dialog.cancel" />}
      </Button>
      {onSubmit !== undefined && (
        <Button onClick={onSubmit} disabled={busy === true || disabled === true}>
          {submitLabel ?? <T k="dialog.save" />}
        </Button>
      )}
    </div>
  );
}

/** Inline error or success strip used inside dialogs and page bodies. */
export function Feedback({
  error,
  notice,
}: {
  error?: string | null;
  notice?: string | null;
}): ReactNode {
  return (
    <>
      {error !== null && error !== undefined && (
        <p
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </p>
      )}
      {notice !== null && notice !== undefined && (
        <p
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
    </>
  );
}
