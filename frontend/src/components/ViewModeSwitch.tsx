export type ViewMode = "tree" | "dag" | "force" | "virtual";

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
  labels: { tree: string; dag: string; force: string; virtual: string };
  disabled?: boolean;
}

const order: ViewMode[] = ["tree", "dag", "force", "virtual"];

export default function ViewModeSwitch({ value, onChange, labels, disabled }: ViewModeSwitchProps) {
  return (
    <div className="relative inline-flex h-9 select-none rounded-lg bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border border-gray-200 dark:border-slate-700 text-xs font-medium overflow-hidden shadow-md p-1 gap-1 max-w-full">
      {order.map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m)}
          className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-2.5 md:px-2.5 px-2 rounded-md h-full transition-all duration-150 focus:outline-none text-[11px] font-medium flex-shrink min-w-0 touch-manipulation whitespace-nowrap ${
            value === m
              ? "text-white scale-[0.98] bg-gradient-to-br from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100/50 dark:hover:bg-slate-700/50"
          }`}
          title={labels[m]}
        >
          {m === "tree" && (
            <svg
              className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0"
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
              className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0"
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
          {m === "force" && (
            <svg
              className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M5.6 5.6l2.8 2.8" />
              <path d="M15.6 15.6l2.8 2.8" />
              <path d="M18.4 5.6l-2.8 2.8" />
              <path d="M8.4 15.6l-2.8 2.8" />
            </svg>
          )}
          {m === "virtual" && (
            <svg
              className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0"
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
          <span className="hidden md:inline whitespace-nowrap">{labels[m]}</span>
        </button>
      ))}
    </div>
  );
}
