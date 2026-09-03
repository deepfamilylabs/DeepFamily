import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  PeopleFilterType,
  PeoplePageT,
  PeopleSortOrder,
} from "../model/peoplePageModel";

export interface SortMenuOption {
  type: PeopleFilterType;
  label: string;
}

interface SortMenuProps {
  t: PeoplePageT;
  options: SortMenuOption[];
  activeType: PeopleFilterType;
  sortOrder: PeopleSortOrder;
  onSelect: (type: PeopleFilterType) => void;
  onSortOrderChange: (order: PeopleSortOrder) => void;
}

/**
 * Sorting as one control instead of a row of pills. Six rules were wide enough
 * to push the search box and the filters onto separate lines; here the current
 * rule stays readable on the button and the rest live one click away, with the
 * direction as an explicit pair rather than a hidden second click.
 */
export default function SortMenu({
  t,
  options,
  activeType,
  sortOrder,
  onSelect,
  onSortOrderChange,
}: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const activeLabel = options.find((option) => option.type === activeType)?.label ?? "";
  const DirectionIcon = sortOrder === "asc" ? ArrowUp : ArrowDown;

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium text-ink-muted border border-hairline bg-surface hover:text-ink hover:border-hairline-strong transition-colors"
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
        <span>{t("people.sortByLabel", "Sort: {{rule}}", { rule: activeLabel })}</span>
        <DirectionIcon className="w-3.5 h-3.5 text-primary" />
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("people.sortRules", "Sort Rules")}
          className="absolute left-0 top-full mt-2 z-50 w-56 rounded-2xl border border-hairline bg-surface p-1.5 shadow-xl shadow-ink/10"
        >
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-subtle">
            {t("people.sortRules", "Sort Rules")}
          </div>

          {options.map((option) => {
            const isActive = option.type === activeType;
            return (
              <button
                key={option.type}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onSelect(option.type);
                  setOpen(false);
                }}
                className={`flex items-center justify-between w-full h-8 px-2 rounded-lg text-[13px] transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-ink hover:bg-surface-alt"
                }`}
              >
                <span>{option.label}</span>
                {isActive && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
              </button>
            );
          })}

          <div className="my-1.5 h-px bg-hairline" />

          <div className="flex items-center gap-1 p-0.5 rounded-[10px] bg-surface-muted">
            <DirectionButton
              label={t("people.sortAscending", "Ascending")}
              isActive={sortOrder === "asc"}
              onClick={() => onSortOrderChange("asc")}
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </DirectionButton>
            <DirectionButton
              label={t("people.sortDescending", "Descending")}
              isActive={sortOrder === "desc"}
              onClick={() => onSortOrderChange("desc")}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </DirectionButton>
          </div>
        </div>
      )}
    </div>
  );
}

function DirectionButton({
  label,
  isActive,
  onClick,
  children,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 h-7 rounded-lg text-xs font-medium transition-colors ${
        isActive ? "bg-surface text-ink shadow-xs" : "text-ink-subtle hover:text-ink-muted"
      }`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
