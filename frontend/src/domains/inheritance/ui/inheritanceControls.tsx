import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { MODAL_HINT } from "../../../shared/ui";

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "compact" | "default" | "large" | "hero";

const FILLED_DISABLED =
  "disabled:bg-surface-muted disabled:text-ink-muted disabled:hover:bg-surface-muted";

/** Orange 700 keeps white button text above 4.5:1; the dark theme keeps the brand fill. */
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: `bg-orange-700 text-white hover:bg-orange-800 focus:ring-orange-700/40 dark:bg-primary dark:text-orange-950 dark:hover:bg-primary-hover ${FILLED_DISABLED}`,
  secondary:
    "border border-hairline-strong bg-surface text-ink hover:bg-surface-alt focus:ring-primary/30 disabled:opacity-50",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  compact: "h-9 rounded-lg px-3 text-xs",
  default: "h-11 rounded-lg px-5 text-sm",
  large: "h-12 rounded-xl px-5 text-[15px]",
  hero: "h-[52px] rounded-xl px-6 text-[15px]",
};

/** Task fields: one height, radius and focus ring across the inheritance forms. */
export const FIELD_BASE =
  "h-11 w-full min-w-0 rounded-[10px] border border-hairline-strong bg-surface px-3 text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-hidden focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted";

export const FIELD_INPUT = `${FIELD_BASE} text-[15px] tabular-nums`;

export const FIELD_TEXTAREA =
  "block w-full min-w-0 resize-y break-all rounded-[10px] border border-hairline-strong bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-hidden focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-muted";

/** Radios and checkboxes take their checked fill from the text colour (@tailwindcss/forms). */
export const CHOICE_INPUT =
  "h-4 w-4 shrink-0 cursor-pointer border-hairline-strong text-orange-600 focus:ring-primary/30 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary";

export const BADGE_ACCENT =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 tabular-nums dark:bg-orange-400/15 dark:text-orange-300";

/** A selectable card or row: selection shows in its border and tint, not colour alone. */
export function choiceCardClass(selected: boolean, disabled = false): string {
  return `rounded-xl border-[1.5px] transition-colors ${
    selected
      ? "border-orange-300 bg-orange-50 dark:border-orange-400/50 dark:bg-orange-400/10"
      : "border-hairline bg-surface hover:border-hairline-strong"
  } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`;
}

export function PanelButton({
  variant = "secondary",
  size = "default",
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 font-semibold leading-tight transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 ring-offset-surface disabled:cursor-not-allowed ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function SelectField({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select
        className={`${FIELD_BASE} cursor-pointer appearance-none bg-none pr-9 text-sm ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />
    </div>
  );
}

/** The heading of a task form and its one-line explanation. */
export function TaskHeader({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h2 id={id} className="ui-heading text-lg text-ink">
        {title}
      </h2>
      {description ? <p className="text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      {children}
    </div>
  );
}

/** A numbered part of a task form; the number marks order, the heading names it. */
export function TaskSection({
  id,
  step,
  title,
  trailing,
  children,
}: {
  id: string;
  step: number;
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="mt-6 flex min-w-0 flex-col gap-3.5 border-t border-hairline/70 pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hairline-strong text-xs font-semibold tabular-nums text-ink/80"
          >
            {step}
          </span>
          <h3 id={id} className="ui-heading text-[15px] text-ink">
            {title}
          </h3>
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function FieldBlock({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="block text-[13px] font-medium text-ink/80" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className={MODAL_HINT}>{hint}</p>
      ) : null}
    </div>
  );
}

export function SuccessNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-ink"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function WarningNotice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm leading-relaxed text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function shortHex(value: string, head = 10, tail = 8): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}
