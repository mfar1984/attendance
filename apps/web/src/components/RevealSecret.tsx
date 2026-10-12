import { Copy, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { T } from '../lib/translation';
import { Dialog, DialogFooter } from './Dialog';
import { PanelNote } from './RecordPanel';
import { Button } from './ui';

/**
 * Shows a credential once.
 *
 * The only moment the value is visible. Nothing stores it in a readable form and no
 * endpoint returns it again — an endpoint that repeats a stored credential becomes the
 * easiest way to extract it, so the answer to losing one is to rotate rather than to
 * reveal.
 *
 * Shared between API tokens, webhook signing keys, connector credentials and app client
 * secrets, because all four are issued the same way and the wording of the warning is the
 * part that must not drift. App clients had their own copy of this dialog until it was
 * folded in here, which is what `identifier` is for.
 */
export function RevealSecret({
  title,
  label,
  value,
  note,
  hint,
  identifier,
  onClose,
}: {
  title: string;
  label: string;
  value: string;
  /** What breaks if this is lost. Stated in the amber strip. */
  note: string;
  /** How to use it, shown under the value. */
  hint?: ReactNode;
  /**
   * The public half of a pair, shown above the secret.
   *
   * An app client is a client ID and a secret, and a build needs both. With this set, the copy
   * button takes the two together — copying only the secret leaves somebody pasting a value
   * with nothing to say which client it belongs to.
   */
  identifier?: { label: string; value: string };
  onClose: () => void;
}): ReactNode {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-3">
        <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          {note}
        </PanelNote>

        {identifier !== undefined && (
          <RevealedValue label={identifier.label} value={identifier.value} />
        )}
        <RevealedValue label={label} value={value} />

        {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}

        <div className="pb-2">
          <Button
            variant="ghost"
            onClick={() => {
              const text = identifier === undefined ? value : `${identifier.value}\n${value}`;
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <Copy className="size-4" aria-hidden />
            <T
              k={
                copied
                  ? 'dialog.copied'
                  : identifier === undefined
                    ? 'dialog.copy'
                    : 'dialog.copyBoth'
              }
            />
          </Button>
        </div>

        {/* Not "Tutup": closing this is an acknowledgement that the value has been kept. */}
        <DialogFooter onClose={onClose} closeLabel={<T k="dialog.recorded" />} />
      </div>
    </Dialog>
  );
}

function RevealedValue({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <code className="mt-1 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs break-all text-slate-100">
        {value}
      </code>
    </div>
  );
}
