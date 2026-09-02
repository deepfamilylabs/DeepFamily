import { ChevronUp, ChevronDown } from "lucide-react";

type SortOrder = "asc" | "desc";

interface SortButtonProps {
  label: string;
  isActive: boolean;
  sortOrder: SortOrder;
  onClick: () => void;
  onSortOrderChange: (order: SortOrder) => void;
  showSortArrows?: boolean;
}

export default function SortButton({
  label,
  isActive,
  sortOrder,
  onClick,
  onSortOrderChange,
  showSortArrows = false,
}: SortButtonProps) {
  const handleClick = () => {
    if (isActive) {
      // Toggle sort order if already active
      onSortOrderChange(sortOrder === "asc" ? "desc" : "asc");
    } else {
      // Activate this sort option
      onClick();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`
        group relative inline-flex items-center justify-center gap-1 h-8 px-3 rounded-full
        text-[12.5px] font-medium whitespace-nowrap select-none
        transition-all duration-200 ease-out border
        ${
          isActive
            ? "bg-primary border-primary text-white shadow-sm shadow-primary/30"
            : "bg-surface border-hairline text-ink-muted hover:text-ink hover:border-hairline-strong"
        }
      `}
      aria-label={`${label} - ${sortOrder === "asc" ? "Ascending" : "Descending"}`}
    >
      <span>{label}</span>
      {isActive && showSortArrows && (
        <span className="flex flex-col -space-y-1 items-center">
          <ChevronUp
            className={`w-3 h-3 transition-colors duration-200 ${
              sortOrder === "asc" ? "text-white" : "text-white/45"
            }`}
            strokeWidth={2.5}
          />
          <ChevronDown
            className={`w-3 h-3 transition-colors duration-200 ${
              sortOrder === "desc" ? "text-white" : "text-white/45"
            }`}
            strokeWidth={2.5}
          />
        </span>
      )}
    </button>
  );
}
