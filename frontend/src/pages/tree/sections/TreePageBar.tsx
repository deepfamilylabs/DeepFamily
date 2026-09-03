import {
  KeyRound,
  Layers,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import type { TFunction } from "i18next";
import { FamilyVolumeNav } from "../../family/FamilyVolumeNav";

export interface TreePageBarProps {
  t: TFunction;
  /** Display name of the root person, or a short hash when the name is not readable yet. */
  rootLabel: string;
  rootVersion: number;
  hasRoot: boolean;
  peopleCount: number;
  generationCount: number;
  loading: boolean;
  /** Versions whose metadata is already unlocked in this browser. */
  unlockedCount: number;
  onOpenUnlock: () => void;
  onRefresh: () => void;
  onClearCaches: () => void;
  /** Whether the genealogy settings drawer is showing; the toggle wears it as a held-down state. */
  configOpen: boolean;
  onToggleConfig: () => void;
}

/**
 * One row of page chrome for /familyTree.
 *
 * The three destinations — lineage chart, genealogy, encyclopedia — are the volumes of a single
 * genealogy, so they read as page-level tabs. The renderers (tree / DAG / list) are three
 * drawings of *this* volume and live on the canvas instead (see ViewContainer), which is what keeps
 * "leave this page" and "redraw this page" from wearing the same pill.
 */
export function TreePageBar({
  t,
  rootLabel,
  rootVersion,
  hasRoot,
  peopleCount,
  generationCount,
  loading,
  unlockedCount,
  onOpenUnlock,
  onRefresh,
  onClearCaches,
  configOpen,
  onToggleConfig,
}: TreePageBarProps) {
  return (
    <div className="flex h-14 shrink-0 items-stretch justify-between gap-3 border-b border-hairline bg-surface px-3 md:px-6">
      <div className="flex min-w-0 items-stretch gap-3 md:gap-5">
        <FamilyVolumeNav settingsOpen={configOpen} onToggleSettings={onToggleConfig} />
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {hasRoot ? (
          <>
            <span className="hidden max-w-[22rem] items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted xl:inline-flex">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
              <span className="shrink-0">{t("familyTree.ui.rootLabel", "Root")}</span>
              <b className="min-w-0 truncate text-[13px] font-semibold text-ink">{rootLabel}</b>
              <span className="shrink-0 font-mono text-ink-subtle">v{rootVersion}</span>
            </span>
            <span className="hidden h-5 w-px bg-hairline xl:block" aria-hidden />
          </>
        ) : null}

        <StatChip
          icon={<Users className="h-3.5 w-3.5 text-ink-subtle" />}
          value={peopleCount}
          unit={t("familyTree.ui.peopleUnit", "People")}
          title={t("familyTree.ui.nodesLabelFull", "Nodes")}
        />
        <StatChip
          icon={<Layers className="h-3.5 w-3.5 text-ink-subtle" />}
          value={generationCount}
          unit={t("familyTree.ui.generationsUnit", "Generations")}
          title={t("familyTree.ui.depthLabelFull", "Depth")}
        />

        <span className="hidden h-5 w-px bg-hairline md:block" aria-hidden />

        <ToolbarButton
          label={t("metadataUnlock.openButton", "Unlock versions")}
          onClick={onOpenUnlock}
          badge={unlockedCount}
        >
          <KeyRound className="h-[15px] w-[15px]" />
        </ToolbarButton>

        <ToolbarButton
          label={t("familyTree.actions.refresh", "Refresh")}
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={`h-[15px] w-[15px] ${loading ? "animate-spin" : ""}`} />
        </ToolbarButton>

        <ToolbarButton
          label={t("familyTree.actions.clearCaches", "Clear caches and reload")}
          onClick={onClearCaches}
          tone="danger"
        >
          <Trash2 className="h-[15px] w-[15px]" />
        </ToolbarButton>
      </div>
    </div>
  );
}

function StatChip({
  icon,
  value,
  unit,
  title,
}: {
  icon: React.ReactNode;
  value: number;
  unit: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className="hidden items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-ink-muted md:inline-flex"
    >
      {icon}
      <b className="text-[13px] font-semibold tabular-nums text-ink">{value}</b>
      {unit}
    </span>
  );
}

/**
 * The three page actions — reload, settings, cache wipe — stay on the bar rather than behind a
 * "more" menu: each is one click from any view, and the wipe carries its weight through hover
 * colour instead of a permanently red pill.
 */
function ToolbarButton({
  label,
  onClick,
  disabled,
  tone = "neutral",
  badge = 0,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  /** Count carried in the corner; hidden at zero. */
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-surface text-ink-muted transition-colors disabled:opacity-50 ${
        tone === "danger"
          ? "hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
          : "hover:border-hairline-strong hover:text-ink"
      }`}
    >
      {children}
      {badge > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-success px-1 text-[10px] font-semibold leading-4 text-surface">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
