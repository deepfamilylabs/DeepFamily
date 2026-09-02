export type ViewMode = "tree" | "dag" | "virtual";

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
  labels: { tree: string; dag: string; virtual: string };
  disabled?: boolean;
}

const order: ViewMode[] = ["tree", "dag", "virtual"];

/**
 * The three renderers of the lineage chart. It floats on the canvas rather than sitting in the page
 * bar, because switching a drawing is not the same act as opening another volume of the genealogy —
 * those are the page bar's tabs.
 */
export default function ViewModeSwitch({ value, onChange, labels, disabled }: ViewModeSwitchProps) {
  return (
    <div className="inline-flex max-w-full select-none items-center gap-0.5 rounded-xl border border-hairline bg-surface-muted/95 p-0.5 shadow-sm backdrop-blur-sm">
      {order.map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={`inline-flex h-7 min-w-0 shrink touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-2.5 text-xs transition-colors duration-200 focus:outline-hidden md:h-8 md:px-3 ${
            value === m
              ? "bg-surface font-semibold text-primary-hover shadow-xs"
              : "font-medium text-ink-subtle hover:text-ink-muted"
          }`}
          title={labels[m]}
        >
          {m === "tree" && (
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v6" />
              <path d="M6 18h12" />
              <path d="M6 21v-6a6 6 0 0 1 12 0v6" />
            </svg>
          )}
          {m === "dag" && (
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="5" cy="5" r="2" />
              <circle cx="19" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="5" cy="19" r="2" />
              <circle cx="19" cy="19" r="2" />
              <path d="M7 5h10" />
              <path d="M6.5 6.5l3.5 3.5" />
              <path d="M17.5 6.5L14 10" />
              <path d="M12 14v3" />
              <path d="M7 19h10" />
            </svg>
          )}
          {m === "virtual" && (
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="7" height="6" rx="1" />
              <rect x="14" y="4" width="7" height="6" rx="1" />
              <rect x="3" y="14" width="7" height="6" rx="1" />
              <rect x="14" y="14" width="7" height="6" rx="1" />
            </svg>
          )}
          <span className="hidden whitespace-nowrap md:inline">{labels[m]}</span>
        </button>
      ))}
    </div>
  );
}
