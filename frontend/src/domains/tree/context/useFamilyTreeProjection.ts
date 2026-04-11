import { useMemo } from "react";
import { useVizOptions } from "./VizOptionsContext";
import { buildViewGraphData, type TreeGraphData } from "../selectors";
import { useTreeGraphData } from "./TreeViewContext";

type FamilyTreeProjectionOptions = {
  /**
   * When false, skips building the projected graph (useful to avoid blocking the first paint).
   * Defaults to true.
   */
  enabled?: boolean;
};

/**
 * Data-only family tree projection for pages that don't render the tree view UI.
 *
 * Important: This hook intentionally does NOT depend on NodeDetail/EndorseModal
 * providers (unlike useFamilyTreeViewModel), so it can be used from any route.
 */
export function useFamilyTreeProjection(options?: FamilyTreeProjectionOptions) {
  const enabled = options?.enabled !== false;
  const { rootId, reachableNodeIds, endorsementsReady, nodesData, edgesUnion, edgesStrict } =
    useTreeGraphData();
  const { deduplicateChildren, childrenMode, strictIncludeUnversionedChildren } = useVizOptions();

  const emptyGraph = useMemo<TreeGraphData>(
    () => ({ nodes: [], edges: [], childrenByParent: {} }),
    [],
  );

  const graph = useMemo(() => {
    if (!enabled) return emptyGraph;
    return buildViewGraphData({
      rootId,
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict,
    });
  }, [
    enabled,
    emptyGraph,
    rootId,
    childrenMode,
    strictIncludeUnversionedChildren,
    deduplicateChildren,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict,
  ]);

  return {
    rootId,
    reachableNodeIds,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict,
    deduplicateChildren,
    childrenMode,
    strictIncludeUnversionedChildren,
    graph,
  };
}
