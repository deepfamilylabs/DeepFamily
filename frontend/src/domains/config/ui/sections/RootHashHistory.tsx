import { useTranslation } from "react-i18next";
import { formatHashMiddle } from "../../../../shared/model";

export interface RootHashHistoryProps {
  items: string[];
  onSelect: (hash: string) => void;
  onRemove: (hash: string) => void;
  onClearAll: () => void;
}

export default function RootHashHistory({
  items,
  onSelect,
  onRemove,
  onClearAll,
}: RootHashHistoryProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
        {t("familyTree.config.rootHistory", "Root hash history")}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {items.map((h) => (
          <div key={h} className="inline-flex items-center gap-1 max-w-full">
            <button
              type="button"
              onClick={() => onSelect(h)}
              className="px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-600 bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-200 hover:border-emerald-500 dark:hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors duration-150 font-mono text-[11px] shadow-xs truncate max-w-[240px]"
              title={h}
            >
              {formatHashMiddle(h)}
            </button>
            <button
              type="button"
              aria-label={t("familyTree.actions.remove", "Remove")}
              className="w-4 h-4 inline-flex items-center justify-center rounded-sm text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors duration-150"
              onClick={() => onRemove(h)}
              title={t("familyTree.actions.remove", "Remove") as string}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1">
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 underline"
        >
          {t("familyTree.actions.clearAll", "Clear all")}
        </button>
      </div>
    </div>
  );
}
