import { useState, type ReactNode } from 'react';

import { staffApi } from '../lib/api';
import { T, useLabels } from '../lib/translation';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import { PanelNote } from './RecordPanel';

/**
 * Confirms a deactivation, and carries it out.
 *
 * One component for the directory and the detail page. Both had their own copy with a footer of
 * their own, and the directory's closed before the request was sent — so a slow terminal left
 * nothing on screen while it worked, and a second press sent the request twice.
 */
export function StaffDeactivateDialog({
  target,
  onClose,
  onDone,
}: {
  target: { id: number; fullName: string };
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await staffApi.deactivate(target.id);
      const failed = result.removal.filter((row) => !row.ok);
      await onDone(
        failed.length === 0
          ? t('staff.deactivate.done', { name: target.fullName, count: result.removal.length })
          : t('staff.deactivate.partial', {
              name: target.fullName,
              count: failed.length,
              devices: failed.map((row) => row.deviceName).join(', '),
            }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('staff.deactivate.error'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="staff.deactivate.title" vars={{ name: target.fullName }} />}
      titleText={t('staff.deactivate.title', { name: target.fullName })}
      description={<T k="staff.deactivate.body" />}
      width="md"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        {/* The last block before the footer, so it carries the `pb-2`. */}
        <div className="pb-2">
          <PanelNote tone="success">
            <T
              k="staff.deactivate.note"
              vars={{
                emphasis: (
                  <strong>
                    <T k="staff.deactivate.kept" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={<T k="staff.deactivate.submit" />}
        />
      </div>
    </Dialog>
  );
}
