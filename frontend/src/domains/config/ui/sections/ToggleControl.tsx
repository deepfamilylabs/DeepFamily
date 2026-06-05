import { HelpCircle } from "lucide-react";

export interface ToggleControlProps {
  /** Visible label and accessible name of the switch (already localized). */
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  tooltipOpen: boolean;
  onToggleTooltip: () => void;
  /** Localized tooltip text for the current state, chosen by the caller from value. */
  tooltip: string;
}

/**
 * Shared label + help-tooltip + pill switch used by the family-tree config toggles
 * (deduplicate, trusted-source filter, strict "include v0", ...). Keeps a single
 * source of truth for the switch markup, focus ring, and accessibility wiring.
 */
export default function ToggleControl({
  label,
  value,
  onChange,
  tooltipOpen,
  onToggleTooltip,
  tooltip,
}: ToggleControlProps) {
  return (
    <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate">
          {label}:
        </span>
        <button
          type="button"
          onClick={onToggleTooltip}
          className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
        >
          <HelpCircle size={14} />
        </button>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 ${
          value ? "bg-gradient-to-r from-orange-400 to-red-500" : "bg-slate-300 dark:bg-slate-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            value ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
      {tooltipOpen && (
        <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
          {tooltip}
        </div>
      )}
    </div>
  );
}
