import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface TraversalControlsProps {
  value: "dfs" | "bfs";
  onChange: (v: "dfs" | "bfs") => void;
  tooltipOpen: boolean;
  onToggleTooltip: () => void;
}

export default function TraversalControls({
  value,
  onChange,
  tooltipOpen,
  onToggleTooltip,
}: TraversalControlsProps) {
  const { t } = useTranslation();
  const buttonBase =
    "px-3 py-1.5 text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 font-medium";
  const active = "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-md";
  const idle =
    "bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-4 text-xs relative z-50">
      <div className="flex items-center justify-between w-full gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {t("familyTree.ui.traversal", "Traversal")}:
          </span>
          <button
            type="button"
            onClick={onToggleTooltip}
            className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
          >
            <HelpCircle size={14} />
          </button>
        </div>
        <div className="inline-flex rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
          <button
            type="button"
            aria-label={t("familyTree.ui.traversalDFS", "DFS")}
            onClick={() => onChange("dfs")}
            className={`${buttonBase} ${value === "dfs" ? active : idle}`}
          >
            DFS
          </button>
          <div className="relative border-l border-slate-300 dark:border-slate-600">
            <button
              type="button"
              aria-label={t("familyTree.ui.traversalBFS", "BFS")}
              onClick={() => onChange("bfs")}
              className={`${buttonBase} ${value === "bfs" ? active : idle}`}
            >
              BFS
            </button>
          </div>
        </div>
        {tooltipOpen && (
          <div className="absolute bottom-full left-0 mb-2 z-[9999] rounded-xl bg-slate-900/95 dark:bg-slate-950/95 text-slate-200 border border-slate-700/50 p-3 text-[11px] shadow-xl animate-in fade-in zoom-in-95 duration-200 w-56 whitespace-normal leading-relaxed">
            <div className="flex flex-col gap-2">
              <div className={value === "dfs" ? "text-white" : "text-slate-500"}>
                {t("familyTree.ui.traversalDFS", "DFS Depth First Search")}
              </div>
              <div className={value === "bfs" ? "text-white" : "text-slate-500"}>
                {t("familyTree.ui.traversalBFS", "BFS Breadth First Search")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
