import { Copy, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Dialog, DialogFooter } from './Dialog';
import { Button } from './ui';

/**
 * Shows a credential once.
 *
 * The only moment the value is visible. Nothing stores it in a readable form and no
 * endpoint returns it again — an endpoint that repeats a stored credential becomes the
 * easiest way to extract it, so the answer to losing one is to rotate rather than to
 * reveal.
 *
 * Shared between API tokens and webhook signing keys because both are issued the same way
 * and the wording of the warning is the part that must not drift.
 */
export function RevealSecret({
  title,
  label,
  value,
  note,
  hint,
  onClose,
}: {
  title: string;
  label: string;
  value: string;
  /** What breaks if this is lost. Stated in the amber strip. */
  note: string;
  /** How to use it, shown under the value. */
  hint?: ReactNode;
  onClose: () => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-3">
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {note}
        </p>

        <div>
          <p className="text-xs font-medium text-slate-600">{label}</p>
          <code className="mt-1 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs break-all text-slate-100">
            {value}
          </code>
        </div>

        {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}

        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          <Copy className="size-4" aria-hidden />
          {copied ? 'Disalin' : 'Salin'}
        </Button>

        {/* Not "Tutup": closing this is an acknowledgement that the value has been kept. */}
        <DialogFooter onClose={onClose} closeLabel="Saya sudah rekod" />
      </div>
    </Dialog>
  );
}
