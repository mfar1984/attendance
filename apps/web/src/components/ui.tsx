import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

import { cn } from '../lib/cn';

const TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-rose-100 text-rose-800',
  success: 'bg-emerald-100 text-emerald-800',
  live: 'bg-emerald-500/15 text-emerald-700',
  /*
    Register, not severity.
    The four above carry a verdict — amber wants attention, rose is broken, emerald is fine. These
    two say nothing about whether the value is good; they exist so a column of two or three
    categories can be told apart by looking. Do not reach for `danger` to colour a category.
  */
  info: 'bg-sky-100 text-sky-800',
  accent: 'bg-fuchsia-100 text-fuchsia-800',
} as const;

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  /**
   * For `uppercase` and the like.
   *
   * Case is presentation, so it belongs here rather than inside the badge as a wrapper `<span>` —
   * and `.toUpperCase()` on a translated string is not safe in every language. Three call sites had
   * grown their own inner span to do this.
   */
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A single headline figure.
 *
 * `hint` carries the caveat rather than a tooltip, because a number whose
 * meaning depends on a hover is a number that gets misread in a report.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  /** Nodes rather than strings, so these can carry their label stamps. */
  label: ReactNode;
  value: string;
  hint?: ReactNode;
  tone?: keyof typeof TONES;
}): ReactNode {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums',
          tone === 'warning' && 'text-amber-700',
          tone === 'danger' && 'text-rose-700',
          tone === 'success' && 'text-emerald-700',
          tone === 'neutral' && 'text-slate-800',
        )}
      >
        {value}
      </p>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
};

export function Button({ variant = 'primary', className, ...rest }: ButtonProps): ReactNode {
  return (
    <button
      className={cn(
        /*
          `whitespace-nowrap` because a button label is a label, not a paragraph. Without it a
          two-word label breaks across lines as soon as the row it sits in gets tight, and the
          control ends up taller than everything beside it — which reads as broken rather than as
          narrow. If the label is too long for the space, the label is too long.
        */
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
        'whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand-600 hover:bg-brand-500 text-white',
        variant === 'ghost' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Labelled input.
 *
 * The label is a real `<label>` bound by id, and errors are announced through
 * `aria-describedby` with `role="alert"`. Placeholder-only labels disappear as
 * soon as typing starts, which is exactly when the field is being filled in.
 */
export function Field({
  label,
  error,
  hint,
  wrapperClassName,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  /** A node rather than a string, so a label can carry its translation badge. */
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  /**
   * Classes for the wrapper rather than the input.
   *
   * Needed because grid placement applies to the field as a whole; putting a
   * `col-span` on the input itself has no effect on the layout.
   */
  wrapperClassName?: string;
}): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('space-y-1.5', wrapperClassName)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800',
          'placeholder:text-slate-400',
          error ? 'border-rose-400' : 'border-slate-300',
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        {...rest}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
/**
 * `Field` for prose that needs more than one line.
 *
 * Same label, hint and error wiring, so a form does not have one field announcing its error
 * through `aria-describedby` and the next one beside it announcing nothing.
 */
export function TextArea({
  label,
  error,
  hint,
  wrapperClassName,
  className,
  rows = 3,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  wrapperClassName?: string;
  /** Classes for the textarea itself — `font-mono` for a template body, for instance. */
  className?: string;
}): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('space-y-1.5', wrapperClassName)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className={cn(
          'w-full resize-y rounded-lg border bg-white px-3 py-2 text-sm text-slate-800',
          'placeholder:text-slate-400',
          error ? 'border-rose-400' : 'border-slate-300',
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        {...rest}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * `Field` for a fixed set of choices, with a visible label.
 *
 * Distinct from `SelectControl` in `ChannelForm`, which carries only an `aria-label` because it
 * sits in a settings row that already shows the label to its left. A select standing in a form
 * grid needs the label drawn, or the column has a control with no heading.
 *
 * Native `<select>` for the same reason `SelectControl` is: the browser's own popup is the one
 * that already behaves with a keyboard, a screen reader and a touch device.
 */
export function SelectField({
  label,
  hint,
  wrapperClassName,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  wrapperClassName?: string;
}): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={cn('space-y-1.5', wrapperClassName)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        aria-describedby={hint !== undefined ? hintId : undefined}
        {...rest}
      >
        {children}
      </select>
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A boolean choice drawn as a box rather than as a line of text.
 *
 * A run of bare checkboxes reads as one paragraph with ticks down the left, and the hint under
 * each one runs into the next label. Boxing them makes each option a target with an edge, and
 * tinting the checked ones means the current state of the whole group is read by looking rather
 * than by checking six small squares in turn.
 *
 * The whole box is the `<label>`, so the hint text is part of the click target. A hint that sits
 * outside it is a line of text that looks clickable beside a control and is not.
 *
 * `icon` is optional and sits with the title. These are scanned in a group, the same reason
 * sidebar entries and `SettingsGroup` headers carry one.
 */
export function CheckCard({
  checked,
  onChange,
  title,
  hint,
  icon,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Nodes rather than strings, so both can carry their label stamps. */
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}): ReactNode {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        disabled && 'cursor-not-allowed opacity-60',
        /*
          `brand-500` and `brand-100`, because those are the steps that exist.
          An earlier version reached for `brand-300` and `brand-50`, which are not in the palette
          in `index.css` — Tailwind emits nothing for a missing step, so `border` fell back to
          `currentColor` and every checked card drew a black outline on white instead of a blue one
          on blue. Check the palette before using a step.
        */
        checked
          ? 'border-brand-500 bg-brand-100/60'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          {icon !== undefined && <span className="text-slate-400">{icon}</span>}
          {title}
        </span>
        {hint !== undefined && (
          <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
        )}
      </span>
    </label>
  );
}
