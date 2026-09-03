import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatHashMiddle } from "../../../../shared/model";
import { CONFIG_LABEL } from "./ConfigControls";

export interface RootHashHistoryProps {
  items: string[];
  onSelect: (hash: string) => void;
  onRemove: (hash: string) => void;
  onClearAll: () => void;
}

/**
 * Previously used roots, directly under the hash field they refill. Each chip is
 * two controls — the hash recalls it, the × drops it — so neither action can be
 * taken by mistake for the other.
 */
export default function RootHashHistory({
  items,
  onSelect,
  onRemove,
  onClearAll,
}: RootHashHistoryProps) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className={CONFIG_LABEL}>{t("familyTree.config.rootHistory", "Root hash history")}</span>
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] text-ink-subtle transition-colors hover:text-danger"
        >
          {t("familyTree.actions.clearAll", "Clear all")}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((h) => (
          <span
            key={h}
            className="inline-flex h-7 max-w-full items-center overflow-hidden rounded-full border border-hairline bg-surface-alt transition-colors hover:border-hairline-strong"
          >
            <button
              type="button"
              onClick={() => onSelect(h)}
              title={h}
              className="min-w-0 truncate py-0 pl-2.5 pr-1 font-mono text-[11px] text-ink-muted transition-colors hover:text-ink"
            >
              {formatHashMiddle(h)}
            </button>
            <button
              type="button"
              onClick={() => onRemove(h)}
              title={t("familyTree.actions.remove", "Remove") as string}
              aria-label={t("familyTree.actions.remove", "Remove") as string}
              className="inline-flex h-full w-6 shrink-0 items-center justify-center text-ink-subtle transition-colors hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
