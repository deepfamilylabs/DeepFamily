import type { ReactNode } from "react";

/**
 * The control vocabulary of the genealogy settings drawer.
 *
 * The panel is one flat column: group headings and hairlines carry the structure
 * that collapsible cards used to, so nothing is more than a scroll away.
 * These primitives keep one label size, one control height and one switch across
 * every field, and consume the semantic tokens rather than raw slate/orange.
 */

export const CONFIG_LABEL = "text-xs font-medium text-ink-muted";

/** Explanatory line under a control. Always visible — these settings are hard to guess. */
export const CONFIG_HINT = "text-[11px] leading-relaxed text-ink-subtle";

export function GroupHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 pt-1 first:pt-0">
      <h3 className="text-[11px] font-semibold tracking-[0.06em] text-ink-subtle">{title}</h3>
      {note ? <span className="text-[11px] text-ink-subtle/80">{note}</span> : null}
      <span className="h-px flex-1 bg-hairline" aria-hidden />
    </div>
  );
}

export interface FieldProps {
  label: string;
  /** Set when the control is a real form element, so the label points at it. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  /** `errorProps` from getFieldErrorA11y, so the message is announced. */
  errorProps?: { id: string; role: "alert" };
  children: ReactNode;
}

/** Label, control, then whichever of error / hint applies. */
export function Field({ label, htmlFor, hint, error, errorProps, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={CONFIG_LABEL}>
          {label}
        </label>
      ) : (
        <span className={CONFIG_LABEL}>{label}</span>
      )}
      {children}
      {error ? (
        <p {...errorProps} className="text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className={CONFIG_HINT}>{hint}</p>
      ) : null}
    </div>
  );
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Names the group for assistive tech; the option labels are too terse alone. */
  label: string;
}

/**
 * Two or three exclusive choices in a muted trough. Replaces the gradient pill
 * pair, which read as a primary action rather than as a state.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-surface-muted p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`h-7 flex-1 rounded-md text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
              active
                ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
                : "font-medium text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  /** What this state means, in words — chosen by the caller from the value. */
  description: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

/**
 * Label, standing description, switch. The description used to hide behind a
 * help icon that opened a floating tooltip; in a 320px drawer there is room to
 * simply say it, and one less click to understand the setting.
 */
export function SwitchRow({ label, description, value, onChange }: SwitchRowProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-ink">{label}</span>
        <span className={CONFIG_HINT}>{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          value ? "bg-primary" : "bg-hairline-strong"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform duration-200 ${
            value ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
