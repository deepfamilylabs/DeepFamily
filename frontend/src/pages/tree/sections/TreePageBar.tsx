import {
  BookOpen,
  GitMerge,
  KeyRound,
  Network,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import type { TFunction } from "i18next";

export interface TreePageBarProps {
  t: TFunction;
  /** Display name of the root person, or a short hash when the name is not readable yet. */
  rootLabel: string;
  rootVersion: number;
  hasRoot: boolean;
  peopleCount: number;
  generationCount: number;
  loading: boolean;
  /** The paper genealogy is only typeset for Chinese, so its volume is language-gated. */
  showPaperVolume: boolean;
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
 * The three destinations — lineage chart, paper genealogy, encyclopedia — are the volumes of a
 * single genealogy, so they read as page-level tabs. The renderers (tree / DAG / list) are three
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
  showPaperVolume,
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
        <span className="flex shrink-0 items-center">
          <ToolbarButton
            label={t("familyTree.actions.openConfig", "Genealogy settings")}
            onClick={onToggleConfig}
            active={configOpen}
            expanded={configOpen}
          >
            <SlidersHorizontal className="h-[15px] w-[15px]" />
          </ToolbarButton>
        </span>

        <h1 className="hidden shrink-0 items-center text-xl text-ink md:flex">
          {t("familyTree.title", "Family")}
        </h1>

        <nav
          className="flex min-w-0 items-stretch gap-4 md:gap-5"
          aria-label={t("familyTree.title", "Family")}
        >
          <VolumeTab to="/familyTree" label={t("familyTree.volumes.chart", "Lineage Chart")} end>
            <Network className="h-[15px] w-[15px] shrink-0" />
          </VolumeTab>
          <VolumeTab to="/people" label={t("familyTree.volumes.people", "Encyclopedia")}>
            <Users className="h-[15px] w-[15px] shrink-0" />
          </VolumeTab>
          {showPaperVolume ? (
            <VolumeTab to="/genealogyBook" label={t("familyTree.volumes.paper", "Paper Genealogy")}>
              <BookOpen className="h-[15px] w-[15px] shrink-0" />
            </VolumeTab>
          ) : null}
        </nav>
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
          icon={<GitMerge className="h-3.5 w-3.5 text-ink-subtle" />}
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

function VolumeTab({
  to,
  label,
  end,
  children,
}: {
  to: string;
  label: string;
  end?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 text-[13px] transition-colors md:gap-2 ${
          isActive
            ? "border-primary font-semibold text-ink"
            : "border-transparent font-medium text-ink-muted hover:text-ink"
        }`
      }
    >
      {children}
      {label}
    </NavLink>
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
  active = false,
  expanded,
  badge = 0,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  /** Held-down look while the button owns an open panel. */
  active?: boolean;
  expanded?: boolean;
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
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
        active
          ? "border-hairline-strong bg-surface-muted text-ink"
          : "border-hairline bg-surface text-ink-muted"
      } ${
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
