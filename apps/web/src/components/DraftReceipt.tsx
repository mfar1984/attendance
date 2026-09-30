import { FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';
import { T, useLabels } from '../lib/translation';
import { RowAction } from './RecordPanel';
import { Button } from './ui';

/** Same ceiling the upload routes enforce, checked here so a 4 MB photo is refused before submit. */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

/**
 * The receipt chosen for a record that does not exist yet.
 *
 * A file cannot travel with the record: it is a handle to something on the user's disk, not a
 * value in the form, and the JSON body has nowhere to put it. So the file waits here, the record
 * is filed, and the file is posted against the id that came back. The wording says so — a control
 * labelled "attach" that does nothing until submit is a control that lies about what it did.
 *
 * Its own component because every record that takes one needs its own hidden input. One input
 * shared across the lines of a claim attaches whatever was chosen to whichever line triggered it
 * last, which is a receipt filed against the wrong cost.
 *
 * `framed` draws it as a block of its own, for a form with one receipt. Unframed it is the strip
 * under a claim line, where the separator is what says the paper belongs to the fields above it.
 */
export function DraftReceipt({
  file,
  required,
  onPick,
  onError,
  framed = false,
}: {
  file: File | null;
  /** Amber when empty only if it is required. An optional empty slot is a detail, not a gap. */
  required: boolean;
  onPick: (file: File | null) => void;
  onError: (message: string) => void;
  framed?: boolean;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const { t } = useLabels();

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5',
        framed
          ? 'rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5'
          : 'mt-3 border-t border-slate-200 pt-2.5',
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <Paperclip className="size-3.5 text-slate-400" aria-hidden />
        <T k="claim.new.items.receipt" />
      </span>

      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          // Cleared so choosing the same file again still fires a change.
          event.target.value = '';
          if (picked === null) return;
          if (picked.size > MAX_RECEIPT_BYTES) {
            onError(t('claim.new.items.receipt.tooBig', { name: picked.name }));
            return;
          }
          onPick(picked);
        }}
      />

      <Button
        variant="ghost"
        onClick={() => input.current?.click()}
        title={t('claim.new.items.receipt.formats')}
      >
        <Upload className="size-4" aria-hidden />
        {file === null ? (
          <T k="claim.new.items.receipt.attach" />
        ) : (
          <T k="claim.new.items.receipt.replace" />
        )}
      </Button>

      {file === null ? (
        <span className={cn('text-xs', required ? 'text-amber-700' : 'text-slate-500')}>
          <T k="claim.new.items.receipt.none" />
        </span>
      ) : (
        <>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-700">
            <FileText className="size-3.5 shrink-0 text-slate-400" aria-hidden />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {Math.max(1, Math.round(file.size / 1024))} KB
            </span>
          </span>
          <span className="text-[11px] text-slate-500 italic">
            <T k="claim.new.items.receipt.pending" />
          </span>
          <RowAction
            icon={<Trash2 className="size-4" aria-hidden />}
            label={t('claim.new.items.receipt.clear')}
            tone="danger"
            onClick={() => onPick(null)}
          />
        </>
      )}
    </div>
  );
}
