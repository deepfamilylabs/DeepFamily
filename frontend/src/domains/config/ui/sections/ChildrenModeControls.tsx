import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ChildrenModeControlsProps {
  mode: "union" | "strict";
  onModeChange: (v: "union" | "strict") => void;
  modeTooltipOpen: boolean;
  onToggleModeTooltip: () => void;
  includeUnversioned: boolean;
  onIncludeUnversionedChange: (v: boolean) => void;
  includeV0TooltipOpen: boolean;
  onToggleIncludeV0Tooltip: () => void;
}

export default function ChildrenModeControls({
  mode,
  onModeChange,
  modeTooltipOpen,
  onToggleModeTooltip,
  includeUnversioned,
  onIncludeUnversionedChange,
  includeV0TooltipOpen,
  onToggleIncludeV0Tooltip,
}: ChildrenModeControlsProps) {
  const { t } = useTranslation();
  const buttonBase =
    "px-3 py-1.5 text-xs transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 font-medium";
  const active = "bg-gradient-to-r from-orange-400 to-red-500 text-white shadow-md";
  const idle =
    "bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
            {t("familyTree.ui.childrenMode", "Children Mode")}:
          </span>
          <button
            type="button"
            onClick={onToggleModeTooltip}
            className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
          >
            <HelpCircle size={14} />
          </button>
        </div>
        <div className="inline-flex rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 overflow-hidden">
          <button
            type="button"
            aria-label="Union children mode"
            onClick={() => onModeChange("union")}
            className={`${buttonBase} ${mode === "union" ? active : idle}`}
          >
            Union
          </button>
          <div className="relative group border-l border-slate-300 dark:border-slate-600">
            <button
              type="button"
              aria-label="Strict children mode"
              onClick={() => onModeChange("strict")}
              className={`${buttonBase} ${mode === "strict" ? active : idle}`}
            >
              Strict
            </button>
          </div>
        </div>
        {modeTooltipOpen && (
          <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
            {mode === "strict"
              ? t(
                  "familyTree.ui.childrenModeTooltip.strict",
                  "Strict: only children attached to this parent version",
                )
              : t(
                  "familyTree.ui.childrenModeTooltip.union",
                  "Union: merge children across all parent versions",
                )}
          </div>
        )}
      </div>

      {mode === "strict" && (
        <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
              {t("familyTree.ui.strictIncludeV0", "Include v0")}:
            </span>
            <button
              type="button"
              onClick={onToggleIncludeV0Tooltip}
              className="text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors focus:outline-none"
            >
              <HelpCircle size={14} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => onIncludeUnversionedChange(!includeUnversioned)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 ${
              includeUnversioned
                ? "bg-gradient-to-r from-orange-400 to-red-500"
                : "bg-slate-300 dark:bg-slate-600"
            }`}
            aria-label={t("familyTree.ui.strictIncludeV0", "Toggle include v0")}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                includeUnversioned ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
          {includeV0TooltipOpen && (
            <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
              {includeUnversioned
                ? t(
                    "familyTree.ui.strictIncludeV0Tooltip.on",
                    "Strict + v0: include unversioned children (parentVersionIndex=0)",
                  )
                : t(
                    "familyTree.ui.strictIncludeV0Tooltip.off",
                    "Strict only: exactly parentVersionIndex you selected",
                  )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
