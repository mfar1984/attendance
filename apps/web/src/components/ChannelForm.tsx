import { CircleCheck, CircleX, Info } from 'lucide-react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/operations-api';
import type { NotificationTrigger } from '../lib/settings-api';
import { T, useLabels } from '../lib/translation';
import { PanelNote } from './RecordPanel';
import { Badge } from './ui';

/**
 * Shared pieces for the settings forms.
 *
 * Extracted once three integration channels needed them, then reused by the device
 * editor. These are long settings forms rather than record tables, so they do not use
 * the `RecordPanel` table shell — but they must not each invent their own row layout
 * either, which is what this prevents. Twenty screens that each hand-roll a grid drift
 * apart within one release, and the drift reads as a half-finished application.
 */

export const CONTROL =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800';

/**
 * The single gap used between controls that share a row.
 *
 * Named rather than repeated so a row of two and a row of three line up. Written by hand
 * at each call site, they diverge by a quarter rem and the column edges stop agreeing
 * down the length of a tab.
 */
const CONTROL_GAP = 'gap-3';

/**
 * Label and hint on the left, control on the right.
 *
 * Chosen over the two-column `FormGrid` used elsewhere because most of these fields need
 * a sentence of explanation — which port pairs with which encryption, what a blank
 * credential means — and a hint under a full-width input pushes the next field off screen.
 */
export function SettingRow({
  label,
  hint,
  required,
  children,
}: {
  /** A node rather than a string, so a row can carry a badge beside its wording. */
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="grid gap-1.5 border-b border-slate-100 py-3 last:border-b-0 sm:grid-cols-[minmax(8rem,13rem)_1fr] sm:gap-5">
      <div className="pt-1.5">
        <p className="text-sm font-medium text-slate-700">
          {label}
          {required === true && (
            <span className="text-rose-500" aria-hidden>
              {' *'}
            </span>
          )}
        </p>
        {hint !== undefined && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A switch rather than a checkbox.
 *
 * These are states something is left in — enabled, authenticating, subscribed — not
 * choices being ticked on a form, and the state reads at a glance from across a desk.
 */
export function Switch({
  checked,
  onChange,
  label,
  showLabel = true,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  /** Off where the surrounding row already names the setting. */
  showLabel?: boolean;
  disabled?: boolean;
}): ReactNode {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 text-sm text-slate-700',
        disabled === true ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300',
          disabled === true && 'cursor-not-allowed',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]',
            checked ? 'left-[1.125rem]' : 'left-0.5',
          )}
        />
      </button>
      {showLabel && <span>{label}</span>}
    </label>
  );
}

/** The enable switch for a whole channel, sat in a section header. */
export function ChannelSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
}): ReactNode {
  const { t } = useLabels();
  return (
    <div className="flex items-center gap-2">
      <span className={cn('text-xs font-medium', enabled ? 'text-emerald-700' : 'text-slate-500')}>
        <T k={enabled ? 'channel.on' : 'channel.off'} />
      </span>
      <Switch
        checked={enabled}
        onChange={onChange}
        label={t('channel.toggle')}
        showLabel={false}
      />
    </div>
  );
}

/**
 * Which events send through this channel.
 *
 * A trigger whose dispatch call does not exist yet is shown as such rather than hidden.
 * Hiding it would mean the list silently grows between releases; disabling it without
 * saying why would read as a bug.
 */
export function TriggerToggles({
  triggers,
  selected,
  onChange,
}: {
  triggers: NotificationTrigger[];
  selected: string[];
  onChange: (next: string[]) => void;
}): ReactNode {
  const { t } = useLabels();

  function toggle(key: string): void {
    onChange(selected.includes(key) ? selected.filter((entry) => entry !== key) : [...selected, key]);
  }

  return (
    <div className="divide-y divide-slate-100">
      {triggers.map((trigger) => {
        const on = selected.includes(trigger.key);
        return (
          <div key={trigger.key} className="flex items-start justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
                <T k={trigger.labelKey} />
                {!trigger.wired && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    <T k="trigger.notWired" />
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                <T k={trigger.detailKey} />
              </p>
            </div>
            <Switch
              checked={on}
              onChange={() => toggle(trigger.key)}
              label={t(trigger.labelKey)}
              showLabel={false}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Outcome of the last test, stored on the channel so it survives a reload. */
export function LastTestResult({
  at,
  ok,
  detail,
}: {
  at: string | null;
  ok: boolean | null;
  detail: string | null;
}): ReactNode {
  if (at === null)
    return (
      <p className="text-sm text-slate-500">
        <T k="channel.test.never" />
      </p>
    );

  return (
    <div className="space-y-1">
      <p className="flex items-center gap-2 text-sm">
        {ok === true ? (
          <Badge tone="success">
            <CircleCheck className="size-3" aria-hidden />
            <T k="channel.test.ok" />
          </Badge>
        ) : (
          <Badge tone="danger">
            <CircleX className="size-3" aria-hidden />
            <T k="channel.test.failed" />
          </Badge>
        )}
        <span className="text-xs text-slate-500">{formatDateTime(at)}</span>
      </p>
      {detail !== null && (
        <p className={cn('text-xs', ok === true ? 'text-slate-600' : 'text-rose-700')}>{detail}</p>
      )}
    </div>
  );
}

/** The blue explanatory strip the reference designs put above a credential block. */
export function ChannelHint({ children }: { children: ReactNode }): ReactNode {
  return (
    <PanelNote icon={<Info className="size-3.5" aria-hidden />} className="mb-1">
      {children}
    </PanelNote>
  );
}
// ---------------------------------------------------------------------------
// Controls that sit in the right-hand cell of a SettingRow
//
// `SettingRow` renders its label as a `<p>` in a sibling cell, not as a `<label>`
// bound to anything. So every control here takes an explicit `label` and puts it on
// `aria-label`: the wording is visible to a sighted reader either way, and without
// this a screen reader reaches an unnamed input. That is why `label` is required
// rather than optional.
// ---------------------------------------------------------------------------

/**
 * Two or three controls sharing one row.
 *
 * Collapses to a single column on narrow viewports, because three number fields at
 * phone width are three fields nobody can read the captions of.
 */
export function ControlGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        'grid grid-cols-1',
        CONTROL_GAP,
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-3',
        columns === 4 && 'sm:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One cell of a `ControlGrid`, with a caption above its control.
 *
 * The caption is needed as soon as a row holds more than one control: "Port" and
 * "Interval" side by side are two unlabelled boxes without it, and the row label on
 * the left can only name one of them.
 */
export function ControlCell({
  caption,
  hint,
  children,
  className,
}: {
  caption?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      {caption !== undefined && (
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{caption}</p>
      )}
      {children}
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Text or number input carrying the shared control styling. */
export function TextControl({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }): ReactNode {
  return <input aria-label={label} className={cn(CONTROL, className)} {...rest} />;
}

/**
 * Native select carrying the shared control styling.
 *
 * Native rather than a custom listbox: the browser's own popup is the one that behaves
 * correctly with a keyboard, with a screen reader and on a touch device, and matching
 * all three by hand is not worth the two pixels of visual control it buys.
 */
export function SelectControl({
  label,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }): ReactNode {
  return (
    <select aria-label={label} className={cn(CONTROL, 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/**
 * A value read from the terminal that nothing here can write.
 *
 * Drawn as a field rather than as bare text so the row still reads as a row, but with
 * a tinted surface and no border focus, because an input-looking box that refuses
 * typing is worse than plain text.
 */
export function StaticControl({
  value,
  mono = false,
  tone = 'neutral',
}: {
  value: ReactNode;
  mono?: boolean;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
}): ReactNode {
  return (
    <p
      className={cn(
        'min-h-[2.375rem] rounded-lg border border-dashed px-3 py-2 text-sm break-words',
        mono && 'font-mono text-xs',
        tone === 'neutral' && 'border-slate-200 bg-slate-50 text-slate-700',
        tone === 'warn' && 'border-amber-300 bg-amber-50 text-amber-900',
        tone === 'danger' && 'border-rose-300 bg-rose-50 text-rose-800',
        tone === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
      )}
    >
      {value}
    </p>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  /** The consequence of picking this one, which is the part worth reading. */
  hint?: ReactNode;
  disabled?: boolean;
}

/**
 * A stacked radio list in the control cell.
 *
 * Stacked rather than inline: each option carries a consequence — "IN/OUT derived from
 * scan order", "less secure, no biometric" — and a sentence per option cannot sit on one
 * line. Each option is a real `<label>` wrapping its input, so the hit area includes the
 * wording and the association is not something this component has to get right.
 */
export function RadioControl({
  name,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: RadioOption[];
  disabled?: boolean;
}): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-1.5">
      {options.map((option) => {
        const locked = disabled === true || option.disabled === true;
        return (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm',
              value === option.value
                ? 'border-brand-300 bg-brand-50/60 text-slate-800'
                : 'border-slate-200 bg-white text-slate-700',
              locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-300',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={locked}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="font-medium">{option.label}</span>
              {option.hint !== undefined && (
                <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
