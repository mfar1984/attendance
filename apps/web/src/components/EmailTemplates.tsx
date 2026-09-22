import { Eye, Mail, RotateCcw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  PanelBody,
  PanelFooter,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
} from './RecordPanel';
import { Badge, Button, CheckCard, Field, TextArea } from './ui';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import {
  hrApi,
  type NotifyModule,
  type EmailTemplate,
  type TemplateEvent,
  type TemplatePayload,
} from '../lib/hr-api';
import { T, useLabels } from '../lib/translation';

const EVENT_LABELS: Record<TemplateEvent, `hr.template.event.${TemplateEvent}`> = {
  submitted: 'hr.template.event.submitted',
  levelApproved: 'hr.template.event.levelApproved',
  approved: 'hr.template.event.approved',
  rejected: 'hr.template.event.rejected',
  cancelled: 'hr.template.event.cancelled',
  awaitingApprover: 'hr.template.event.awaitingApprover',
  // Payroll and KPI raise their own events. Which ones appear here is the server's answer, not
  // this map's: it sends only the events the module can fire.
  payslipReady: 'hr.template.event.payslipReady',
  awardApproved: 'hr.template.event.awardApproved',
  awardCancelled: 'hr.template.event.awardCancelled',
  lendingApproved: 'hr.template.event.lendingApproved',
  reviewAssigned: 'hr.template.event.reviewAssigned',
  appraisalFinalised: 'hr.template.event.appraisalFinalised',
};

/**
 * The wording each notification carries, per module.
 *
 * Editable because the wording of a decision email is a hospital's own — their department
 * names, their escalation instructions, their tone. Coded, every one of those becomes a
 * request to change a sentence, which is a deployment.
 *
 * An unedited event shows the seeded default rather than an empty box. A blank editor invites
 * somebody to write a notice from nothing, and the first thing they would leave out is the
 * reference number.
 */
export function EmailTemplates({
  module,
  screen,
}: {
  module: NotifyModule;
  screen: string;
}): ReactNode {
  const [data, setData] = useState<TemplatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const { t } = useLabels();
  const { can } = useAuth();

  const mayConfigure = can(screen, 'configure');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await hrApi.templates(module));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PanelSection
        icon={<Mail className="size-4" aria-hidden />}
        title={<T k="hr.template.title" />}
        subtitle={<T k="hr.template.subtitle" />}
      />

      {/*
        The paragraph rule moved into the dialog, beside the body field it governs. Restating it
        above the table put a formatting note on a screen somebody opens to scan six rows.
      */}
      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        framed
        loading={loading}
        rowCount={data?.templates.length ?? 0}
        empty={<T k="hr.template.empty" />}
        columns={[
          { header: <T k="hr.template.column.event" />, width: 'w-64' },
          { header: <T k="hr.template.column.subject" /> },
          { header: <T k="hr.template.column.state" />, width: 'w-32' },
          { header: <T k="panel.column.actions" />, width: 'w-28', align: 'right' },
        ]}
      >
        {(data?.templates ?? []).map((row) => (
          <tr
            key={row.event}
            className={cn(
              'border-b border-slate-100 hover:bg-slate-50/70',
              !row.enabled && 'bg-slate-50/60',
            )}
          >
            <td className="px-5 py-2">
              <span className={cn('block', row.enabled ? 'text-slate-800' : 'text-slate-400')}>
                <T k={EVENT_LABELS[row.event]} />
              </span>
              <span className="block text-[11px] text-slate-400">
                <T
                  k={
                    row.audience === 'approver'
                      ? 'hr.template.audience.approver'
                      : 'hr.template.audience.applicant'
                  }
                />
              </span>
            </td>
            <td className="px-2 py-2 text-xs text-slate-600">
              <span className="line-clamp-1">{row.subject}</span>
            </td>
            {/*
              One `Badge`, three states, no wrapper spans. The uppercase belongs in the badge's own
              class rather than an inner `<span>` — three copies of the same element differing only
              in tone was the shape that invited one of them to drift.
            */}
            <td className="px-2 py-2.5">
              <Badge
                tone={!row.enabled ? 'neutral' : row.customised ? 'success' : 'info'}
                className="uppercase"
              >
                <T
                  k={
                    !row.enabled
                      ? 'hr.template.disabled'
                      : row.customised
                        ? 'hr.template.customised'
                        : 'hr.template.default'
                  }
                />
              </Badge>
            </td>
            <td className="px-2 py-2 pr-4">
              <RowActions>
                <RowAction
                  icon={<Eye className="size-4" aria-hidden />}
                  label={t('hr.template.action.edit')}
                  onClick={() => setEditing(row)}
                />
                {mayConfigure && (
                  <RowAction
                    icon={<RotateCcw className="size-4" aria-hidden />}
                    label={t('hr.template.action.revert')}
                    tone="warn"
                    // Nothing to revert to when the row is already the seeded default.
                    disabled={!row.customised}
                    onClick={async () => {
                      try {
                        await hrApi.revertTemplate(module, row.event);
                        setNotice(t('hr.template.reverted'));
                        await load();
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : null);
                      }
                    }}
                  />
                )}
              </RowActions>
            </td>
          </tr>
        ))}
      </RecordTable>

      <PanelFooter
        shown={data?.templates.length ?? 0}
        total={data?.templates.length ?? 0}
        page={1}
        pageSize={Math.max(1, data?.templates.length ?? 1)}
        loading={loading}
        onPage={() => undefined}
        onPageSize={() => undefined}
        onRefresh={() => void load()}
      />

      {editing !== null && data !== null && (
        <TemplateDialog
          module={module}
          target={editing}
          placeholders={data.placeholders}
          readOnly={!mayConfigure}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            setNotice(t('hr.template.saved'));
            await load();
          }}
        />
      )}
    </>
  );
}

function TemplateDialog({
  module,
  target,
  placeholders,
  readOnly,
  onClose,
  onDone,
}: {
  module: NotifyModule;
  target: EmailTemplate;
  placeholders: string[];
  readOnly: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}): ReactNode {
  const [subject, setSubject] = useState(target.subject);
  const [body, setBody] = useState(target.body);
  const [enabled, setEnabled] = useState(target.enabled);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  /**
   * Appends rather than inserting at the caret.
   *
   * A caret-aware insert needs a ref into the textarea and breaks the moment the field is
   * re-rendered from state. Appending is predictable, and the operator can move it.
   */
  const insert = (name: string): void => {
    setBody((current) => `${current}{{${name}}}`);
  };

  const runPreview = async (): Promise<void> => {
    try {
      const result = await hrApi.previewTemplate(module, target.event, { subject, body });
      setPreview({ subject: result.subject, body: result.body });
      setUnknown(result.unknown);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : null);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await hrApi.saveTemplate(module, target.event, { subject, body, enabled });
      await onDone();
    } catch (cause) {
      // The server refuses unknown placeholders and names them, so this message is the
      // useful one — it says which field to fix.
      setError(cause instanceof Error ? cause.message : null);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={<T k={EVENT_LABELS[target.event]} />}
      titleText={t(EVENT_LABELS[target.event])}
      description={
        <T
          k={
            target.audience === 'approver'
              ? 'hr.template.audience.approver'
              : 'hr.template.audience.applicant'
          }
        />
      }
      /*
        `2xl`, matching the leave type dialog. This form holds a twelve-row monospace body and a grid
        of placeholder chips; at `lg` (672px) the chips wrapped to four rows and the body was a narrow
        column of wrapped template lines, which is the hardest shape to proofread an email in.
      */
      width="2xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <Field
          label={<T k="hr.template.form.subject" />}
          value={subject}
          maxLength={255}
          disabled={readOnly}
          onChange={(event) => setSubject(event.target.value)}
        />

        {/*
          `TextArea` from `ui`, so the label and hint are wired the same way every other field on
          every other form is. The paragraph rule is the hint, which is where it belongs: beside the
          box it governs rather than in a strip above the table.
        */}
        <TextArea
          label={<T k="hr.template.form.body" />}
          hint={<T k="hr.template.note.paragraphs" />}
          rows={12}
          value={body}
          disabled={readOnly}
          maxLength={8000}
          onChange={(event) => setBody(event.target.value)}
          className="font-mono text-xs"
        />

        <div>
          <p className="text-sm font-medium text-slate-700">
            <T k="hr.template.form.placeholders" />
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            <T k="hr.template.form.placeholders.hint" />
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {placeholders.map((name) => (
              <button
                key={name}
                type="button"
                disabled={readOnly}
                onClick={() => insert(name)}
                className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {`{{${name}}}`}
              </button>
            ))}
          </div>
        </div>

        {!readOnly && (
          <CheckCard
            checked={enabled}
            onChange={setEnabled}
            icon={<Mail className="size-4" aria-hidden />}
            title={<T k="hr.template.form.enabled" />}
            hint={<T k="hr.template.form.enabled.hint" />}
          />
        )}

        {unknown.length > 0 && (
          <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="hr.template.form.unknown" vars={{ names: unknown.join(', ') }} />
          </PanelNote>
        )}

        {/*
          `pb-2` on the block, not just `pt-3` above it.
          `DialogFooter` is `sticky bottom-0` with negative margins cancelling the body padding, so
          on a form long enough to scroll it floats over whatever is beneath — and the preview button
          was landing against the footer's own rule with no space between the two.
        */}
        <div className="border-t border-slate-200 pt-4 pb-2">
          <Button variant="ghost" onClick={() => void runPreview()}>
            <Eye className="size-4" aria-hidden />
            <T k="hr.template.action.preview" />
          </Button>

          {preview !== null && (
            <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <T k="hr.template.preview.title" />
              </p>
              <p className="text-sm font-medium text-slate-800">{preview.subject}</p>
              {/* Rendered as pre-wrapped text, never as HTML: the body is operator input. */}
              <p className="text-xs whitespace-pre-wrap text-slate-600">{preview.body}</p>
              <p className="text-[11px] text-slate-400">
                <T k="hr.template.preview.hint" />
              </p>
            </div>
          )}
        </div>

        {!readOnly && (
          <DialogFooter
            onClose={onClose}
            onSubmit={() => void submit()}
            busy={busy}
            disabled={subject.trim() === '' || body.trim() === ''}
            submitLabel={<T k="dialog.save" />}
          />
        )}
      </div>
    </Dialog>
  );
}
