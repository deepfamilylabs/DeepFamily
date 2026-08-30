import type React from "react";
import { Clipboard } from "lucide-react";

type CopyIconButtonSize = "xs" | "sm" | "md";
type CopyIconButtonVisibility = "always" | "group-hover";

const SIZE_CLASSES: Record<CopyIconButtonSize, { button: string; icon: number }> = {
  xs: { button: "h-6 w-6", icon: 12 },
  sm: { button: "h-7 w-7", icon: 14 },
  md: { button: "h-8 w-8", icon: 16 },
};

export type CopyIconButtonProps = {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  disabled?: boolean;
  size?: CopyIconButtonSize;
  stopPropagation?: boolean;
  visibility?: CopyIconButtonVisibility;
};

export function CopyIconButton({
  label,
  onClick,
  className = "",
  disabled = false,
  size = "sm",
  stopPropagation = false,
  visibility = "always",
}: CopyIconButtonProps) {
  const sizeConfig = SIZE_CLASSES[size];
  const visibilityClass =
    visibility === "group-hover"
      ? "opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
      : "";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
        onClick(event);
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 ring-offset-surface disabled:pointer-events-none disabled:opacity-50 ${sizeConfig.button} ${visibilityClass} ${className}`}
    >
      <Clipboard size={sizeConfig.icon} strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
