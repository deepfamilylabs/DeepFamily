import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { MODAL_HINT, MODAL_LABEL } from "../../../shared/ui";

type ButtonVariant = "primary" | "secondary";

const FILLED_DISABLED =
  "disabled:bg-surface-muted disabled:text-ink-muted disabled:hover:bg-surface-muted";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: `bg-primary text-white dark:text-orange-950 hover:bg-primary-hover focus:ring-primary/40 ${FILLED_DISABLED}`,
  secondary:
    "border border-hairline-strong bg-surface text-ink hover:bg-surface-alt focus:ring-primary/30 disabled:opacity-50",
};

export function PanelButton({
  variant = "secondary",
  size = "default",
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "default" | "compact";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold leading-tight transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 ring-offset-surface disabled:cursor-not-allowed ${size === "compact" ? "h-9 px-3 text-xs" : "h-11 px-5 text-sm"} ${BUTTON_VARIANT[variant]} ${className}`}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function PanelShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-hairline bg-surface p-5 sm:p-6">
      <h2 className="text-lg text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
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
    <div className="space-y-1.5">
      <label className={MODAL_LABEL} htmlFor={htmlFor}>
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
    <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function shortHex(value: string, head = 10, tail = 8): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}
