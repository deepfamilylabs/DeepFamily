import type { ButtonHTMLAttributes } from "react";

type TransactionButtonVariant = "primary" | "secondary" | "subtle" | "info";

interface TransactionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TransactionButtonVariant;
}

const variantClasses: Record<TransactionButtonVariant, string> = {
  primary:
    "bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-500 disabled:hover:bg-orange-600",
  secondary:
    "border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:ring-gray-400",
  subtle:
    "border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30 focus:ring-orange-500",
  info: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:hover:bg-blue-600",
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
      className={`inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-950 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
