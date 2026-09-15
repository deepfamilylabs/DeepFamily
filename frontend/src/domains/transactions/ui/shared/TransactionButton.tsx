import type { ButtonHTMLAttributes } from "react";

type TransactionButtonVariant = "primary" | "secondary" | "subtle" | "info";

interface TransactionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TransactionButtonVariant;
}

/**
 * A filled action that is not ready yet turns grey instead of fading: half an
 * orange over the dark surface reads as brown, and its dark label sinks into it.
 */
const FILLED_DISABLED =
  "disabled:bg-surface-muted disabled:text-ink-muted disabled:hover:bg-surface-muted disabled:hover:opacity-100";

/**
 * The primary action stays brand orange in every flow — the accent identifies
 * the dialog (its header tile), never the button.
 */
const variantClasses: Record<TransactionButtonVariant, string> = {
  primary: `bg-primary text-white dark:text-orange-950 hover:bg-primary-hover focus:ring-primary/40 ${FILLED_DISABLED}`,
  secondary:
    "border border-hairline-strong bg-surface text-ink hover:bg-surface-alt focus:ring-primary/30 disabled:opacity-50",
  subtle:
    "border border-primary/30 bg-primary/10 text-orange-700 dark:text-orange-300 hover:bg-primary/15 focus:ring-primary/30 disabled:opacity-50",
  info: `bg-info text-white dark:text-blue-950 hover:opacity-90 focus:ring-info/40 ${FILLED_DISABLED}`,
};

export function TransactionButton({
  type = "button",
  variant = "secondary",
  className = "",
  children,
  ...props
}: TransactionButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 h-11 px-5 text-sm leading-tight font-semibold rounded-lg transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 ring-offset-surface disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
