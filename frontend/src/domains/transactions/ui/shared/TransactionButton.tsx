import type { ButtonHTMLAttributes } from "react";

type TransactionButtonVariant = "primary" | "secondary" | "subtle" | "info";

interface TransactionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TransactionButtonVariant;
}

/**
 * The primary action stays brand orange in every flow — the accent identifies
 * the dialog (its header tile), never the button.
 */
const variantClasses: Record<TransactionButtonVariant, string> = {
  primary:
    "bg-primary text-white dark:text-orange-950 hover:bg-primary-hover focus:ring-primary/40 disabled:hover:bg-primary",
  secondary:
    "border border-hairline-strong bg-surface text-ink hover:bg-surface-alt focus:ring-primary/30",
  subtle:
    "border border-primary/30 bg-primary/10 text-orange-700 dark:text-orange-300 hover:bg-primary/15 focus:ring-primary/30",
  info: "bg-info text-white dark:text-blue-950 hover:opacity-90 focus:ring-info/40 disabled:hover:bg-info",
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
      className={`inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-semibold rounded-lg transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-2 ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
