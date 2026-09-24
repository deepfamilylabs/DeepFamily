import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ethers } from "ethers";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { MODAL_HINT, MODAL_LABEL } from "../../../shared/ui";
import type { FriendlyError } from "../../../shared/lib/errors";

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
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold leading-tight transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 ring-offset-surface disabled:cursor-not-allowed ${BUTTON_VARIANT[variant]} ${className}`}
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

export function IdentityBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface-alt/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      {children}
    </p>
  );
}

export function ErrorNotice({ error }: { error: FriendlyError }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{error.message}</span>
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

/** Hashes a result leaves behind, each labelled so none is taken for the inheritance id. */
export function HashList({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 text-xs text-ink-muted">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt>{item.label}</dt>
          <dd className="min-w-0 break-all font-mono">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Label/value rows for a summary; values may be long hashes, so they wrap. */
export function FactList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-ink-muted">{item.label}</dt>
          <dd className="min-w-0 break-all text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The 32-byte word InheritanceCreated indexes; set-up and claim must print it alike. */
export function formatCredential(credential: bigint): string {
  return ethers.toBeHex(credential, 32);
}

export function shortHex(value: string, head = 10, tail = 8): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

export function formatBlockDate(seconds: bigint, locale: string): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
