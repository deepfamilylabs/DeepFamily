import type { TFunction } from "i18next";

export interface TreeStatsPillProps {
  t: TFunction;
  peopleCount: number;
  generationCount: number;
  className?: string;
}

/**
 * The counts, for widths where the page bar has room only for the volume tabs. Rides the same
 * floating-card language as the palette it sits next to.
 */
export function TreeStatsPill({ t, peopleCount, generationCount, className = "" }: TreeStatsPillProps) {
  return (
    <span
      className={`inline-flex h-[34px] items-center gap-2 rounded-xl border border-hairline bg-surface/95 px-3 text-xs text-ink-muted shadow-sm backdrop-blur-sm ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <b className="text-[13px] font-semibold tabular-nums text-ink">{peopleCount}</b>
        {t("familyTree.ui.peopleUnit", "People")}
      </span>
      <span className="h-3 w-px bg-hairline" aria-hidden />
      <span className="inline-flex items-center gap-1">
        <b className="text-[13px] font-semibold tabular-nums text-ink">{generationCount}</b>
        {t("familyTree.ui.generationsUnit", "Generations")}
      </span>
    </span>
  );
}
