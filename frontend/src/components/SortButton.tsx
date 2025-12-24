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
      onClick={handleClick}
      className={`
        group relative inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg
        text-sm font-medium whitespace-nowrap
        transition-all duration-200 ease-out
        ${
          isActive
            ? "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30 scale-105"
            : "bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200"
        }
      `}
      aria-label={`${label} - ${sortOrder === "asc" ? "Ascending" : "Descending"}`}
    >
      <span>{label}</span>
      {isActive && showSortArrows && (
        <div className="flex flex-col -space-y-2 items-center ml-0.5">
          <ChevronUp
            className={`w-3.5 h-3.5 transition-all duration-200 ${
              sortOrder === "asc" ? "text-white drop-shadow-sm" : "text-white/30"
            }`}
            strokeWidth={2.5}
          />
          <ChevronDown
            className={`w-3.5 h-3.5 transition-all duration-200 ${
              sortOrder === "desc" ? "text-white drop-shadow-sm" : "text-white/30"
            }`}
            strokeWidth={2.5}
          />
        </div>
      )}
    </button>
  );
}
