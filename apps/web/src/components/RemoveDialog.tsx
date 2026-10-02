import { useState, type ReactNode } from 'react';

import { T, useLabels } from '../lib/translation';
import { Dialog, DialogFooter, Feedback } from './Dialog';

/**
 * Confirms removing a record that nothing refers to any more.
 *
 * The row action that opens this is already greyed, with the reason in its tooltip, while anything
 * still points at the record — so this only ever opens for one that is safe to remove, and it says
 * so in `description`. The server still refuses if something was attached since the list was read,
 * and that refusal lands here rather than as a strip on the page behind the dialog.
 *
 * Shared because the reference-data screens each grew their own: a hand-drawn rule above a rose
 * button, in place of the footer every other dialog closes with.
 */
export function RemoveDialog({
  title,
  titleText,
  description,
  onConfirm,
  onClose,
  submitLabel,
}: {
  title: ReactNode;
  titleText: string;
  description: ReactNode;
  /** Performs the removal; a thrown error is shown in the dialog and keeps it open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
  submitLabel?: ReactNode;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.remove'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      titleText={titleText}
      description={description}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />
        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={submitLabel ?? <T k="app.remove" />}
        />
      </div>
    </Dialog>
  );
}
