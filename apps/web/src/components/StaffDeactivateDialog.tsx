import { useState, type ReactNode } from 'react';

import { staffApi, type DeviceSyncOutcome } from '../lib/api';
import { T, useLabels, type LabelVars } from '../lib/translation';
import type { LabelKey } from '@attendance/shared';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import { PanelNote } from './RecordPanel';

/**
 * What a deactivation actually achieved on each terminal, as one sentence or two.
 *
 * Exported because the staff form switches somebody off as well — the server runs the same
 * `removeStaffFromDevices` for both — and two copies of this wording would diverge. The one that
 * diverged would be the one still reporting a queued removal as done, which is the reading this
 * exists to remove: a leaver who can still open a door, on the screen whose whole job is to say
 * they cannot.
 *
 * `ok` with `pending` is "the command is recorded and the unit has not collected it". Its own
 * sentence, because it is only sometimes true and a slot would leave punctuation stranded on the
 * removals every terminal confirmed.
 */
export function reportRemoval(
  t: (key: LabelKey, vars?: LabelVars) => string,
  name: string,
  removal: DeviceSyncOutcome[],
): string {
  const failed = removal.filter((row) => !row.ok);
  const waiting = removal.filter((row) => row.ok && row.pending === true);

  return [
    failed.length === 0
      ? t('staff.deactivate.done', { name, count: removal.length })
      : t('staff.deactivate.partial', {
          name,
          count: failed.length,
          devices: failed.map((row) => row.deviceName).join(', '),
        }),
    ...(waiting.length > 0
      ? [
          t('staff.deactivate.pending', {
            count: waiting.length,
            devices: waiting.map((row) => row.deviceName).join(', '),
          }),
        ]
      : []),
  ].join(' ');
}

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
      await onDone(reportRemoval(t, target.fullName, result.removal));
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
