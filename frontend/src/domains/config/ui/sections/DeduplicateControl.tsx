import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DeduplicateControlProps {
  value: boolean;
  onChange: (v: boolean) => void;
  tooltipOpen: boolean;
  onToggleTooltip: () => void;
}

export default function DeduplicateControl({
  value,
  onChange,
  tooltipOpen,
  onToggleTooltip,
}: DeduplicateControlProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 flex-shrink-0 relative">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap">
          {t("familyTree.ui.deduplicateChildren", "Deduplicate Children")}:
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
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:focus-visible:ring-orange-400/60 ${
          value ? "bg-gradient-to-r from-orange-400 to-red-500" : "bg-slate-300 dark:bg-slate-600"
        }`}
        aria-label={t("familyTree.ui.deduplicateChildren", "Toggle deduplicate children")}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            value ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
      {tooltipOpen && (
        <div className="absolute -top-8 left-0 z-[9999] whitespace-nowrap rounded bg-slate-900/90 dark:bg-slate-950/90 text-white px-2 py-1 text-[10px] shadow-lg animate-in fade-in zoom-in-95 duration-200">
          {value
            ? t(
                "familyTree.ui.deduplicateChildrenTooltip.enabled",
                "Highest endorsed version only",
              )
            : t("familyTree.ui.deduplicateChildrenTooltip.disabled", "Show all versions")}
        </div>
      )}
    </div>
  );
}
