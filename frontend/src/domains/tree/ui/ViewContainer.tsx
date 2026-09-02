import React, { Suspense } from "react";
import ColorPalette from "./ColorPalette";
import LoadingSkeleton from "./LoadingSkeleton";
import TreeListView from "./TreeListView";
import ViewModeSwitch from "./ViewModeSwitch";
import { FamilyTreeViewConfigProvider } from "../context";

const DagView = React.lazy(() => import("./DagView"));
const TreeLayoutView = React.lazy(() => import("./TreeLayoutView"));

interface ViewContainerProps {
  viewMode: "dag" | "tree" | "virtual";
  hasRoot: boolean;
  contractMessage: string;
  loading: boolean;
  skeletonLines?: number;
  onViewModeChange?: (mode: "dag" | "tree" | "virtual") => void;
  viewModeLabels?: { tree: string; dag: string; virtual: string };
  /** Sits beside the palette in the top-left overlay row — page-owned chrome, same card language. */
  overlayLeading?: React.ReactNode;
}

export default function ViewContainer({
  viewMode,
  hasRoot,
  contractMessage,
  loading,
  onViewModeChange,
  viewModeLabels,
  overlayLeading,
}: ViewContainerProps) {
  // useVizOptions internally inside views / contexts
  const content = hasRoot ? (
    viewMode === "dag" ? (
      <DagView />
    ) : viewMode === "tree" ? (
      <TreeLayoutView />
    ) : (
      <TreeListView />
    )
  ) : (
    <div className="flex min-h-[520px] w-full items-center justify-center bg-surface-body p-4 transition-all duration-300 md:min-h-[680px]">
      {loading ? (
        <LoadingSkeleton />
      ) : contractMessage ? (
        <div className="text-sm text-ink-muted">{contractMessage}</div>
      ) : (
        <LoadingSkeleton />
      )}
    </div>
  );
  return (
    <div className="relative h-full w-full transition-colors">
      {/* Top-left overlay row: palette first, then whatever the page hangs beside it. */}
      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 md:left-4 md:top-4">
        <ColorPalette />
        {overlayLeading}
      </div>

      {/* The renderers stay on the canvas: they redraw this page rather than leave it. */}
      {onViewModeChange && viewModeLabels ? (
        <div className="absolute right-3 top-3 z-30 md:right-4 md:top-4">
          <ViewModeSwitch value={viewMode} onChange={onViewModeChange} labels={viewModeLabels} />
        </div>
      ) : null}

      <FamilyTreeViewConfigProvider>
        <Suspense fallback={<LoadingSkeleton />}>{content}</Suspense>
      </FamilyTreeViewConfigProvider>
    </div>
  );
}
