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
        group relative inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full
        text-sm font-medium whitespace-nowrap select-none
        transition-all duration-200 ease-out border
        ${
          isActive
            ? "bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/25 ring-2 ring-orange-500/20"
            : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
        }
      `}
      aria-label={`${label} - ${sortOrder === "asc" ? "Ascending" : "Descending"}`}
    >
      <span>{label}</span>
      {isActive && showSortArrows && (
        <div className="flex flex-col -space-y-1 items-center ml-0.5">
          <ChevronUp
            className={`w-3.5 h-3.5 transition-all duration-200 ${
              sortOrder === "asc" ? "text-white drop-shadow-sm" : "text-white/40"
            }`}
            strokeWidth={2.5}
          />
          <ChevronDown
            className={`w-3.5 h-3.5 transition-all duration-200 ${
              sortOrder === "desc" ? "text-white drop-shadow-sm" : "text-white/40"
            }`}
            strokeWidth={2.5}
          />
        </div>
      )}
    </button>
  );
}
