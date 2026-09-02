import { BookOpen, GitMerge, MoreHorizontal, Network, RefreshCw, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  onRefresh: () => void;
  onClearCaches: () => void;
  onOpenConfig: () => void;
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
  onRefresh,
  onClearCaches,
  onOpenConfig,
}: TreePageBarProps) {
  return (
    <div className="flex h-14 shrink-0 items-stretch justify-between gap-3 border-b border-hairline bg-surface px-3 md:px-6">
      <div className="flex min-w-0 items-stretch gap-4 md:gap-5">
        <h1 className="hidden shrink-0 items-center text-xl text-ink md:flex">
          {t("familyTree.title", "Family Tree")}
        </h1>

        <nav
          className="flex min-w-0 items-stretch gap-4 md:gap-5"
          aria-label={t("familyTree.title", "Family Tree")}
        >
          <VolumeTab to="/familyTree" label={t("familyTree.volumes.chart", "Lineage Chart")} end>
            <Network className="h-[15px] w-[15px] shrink-0" />
          </VolumeTab>
          {showPaperVolume ? (
            <VolumeTab
              to="/genealogyBook"
              label={t("familyTree.volumes.paper", "Paper Genealogy")}
            >
              <BookOpen className="h-[15px] w-[15px] shrink-0" />
            </VolumeTab>
          ) : null}
          <VolumeTab to="/people" label={t("familyTree.volumes.people", "Encyclopedia")}>
            <Users className="h-[15px] w-[15px] shrink-0" />
          </VolumeTab>
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

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title={t("familyTree.actions.refresh", "Refresh")}
          aria-label={t("familyTree.actions.refresh", "Refresh")}
          className="hidden h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-surface text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-50 md:inline-flex"
        >
          <RefreshCw className={`h-[15px] w-[15px] ${loading ? "animate-spin" : ""}`} />
        </button>

        <OverflowMenu
          t={t}
          loading={loading}
          onRefresh={onRefresh}
          onClearCaches={onClearCaches}
          onOpenConfig={onOpenConfig}
        />
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
 * Everything that is neither read at a glance nor pressed often: the cache wipe used to be a red
 * pill in the toolbar, louder than the page title.
 */
function OverflowMenu({
  t,
  loading,
  onRefresh,
  onClearCaches,
  onOpenConfig,
}: {
  t: TFunction;
  loading: boolean;
  onRefresh: () => void;
  onClearCaches: () => void;
  onOpenConfig: () => void;
}) {
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

  const itemClassName =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink transition-colors hover:bg-surface-muted disabled:opacity-50";

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("familyTree.actions.more", "More")}
        aria-label={t("familyTree.actions.more", "More")}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          open
            ? "border-hairline-strong bg-surface-muted text-ink"
            : "border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink"
        }`}
      >
        <MoreHorizontal className="h-[15px] w-[15px]" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t("familyTree.actions.more", "More")}
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-hairline bg-surface p-1.5 shadow-xl shadow-ink/10"
        >
          <button
            type="button"
            role="menuitem"
            disabled={loading}
            onClick={() => {
              setOpen(false);
              onRefresh();
            }}
            className={`${itemClassName} md:hidden`}
          >
            <RefreshCw
              className={`h-[15px] w-[15px] text-ink-subtle ${loading ? "animate-spin" : ""}`}
            />
            {t("familyTree.actions.refresh", "Refresh")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenConfig();
            }}
            className={itemClassName}
          >
            <SlidersHorizontal className="h-[15px] w-[15px] text-ink-subtle" />
            {t("familyTree.actions.openConfig", "Genealogy settings")}
          </button>

          <span className="my-1 block h-px bg-hairline" aria-hidden />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onClearCaches();
            }}
            title={t("familyTree.config.clearAndRefresh", "Clear")}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 className="h-[15px] w-[15px]" />
            {t("familyTree.actions.clearCaches", "Clear caches and reload")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
