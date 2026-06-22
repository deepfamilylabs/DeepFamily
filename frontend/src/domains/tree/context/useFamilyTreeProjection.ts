import { useMemo } from "react";
import { useVizOptions } from "./VizOptionsContext";
import { buildSpouseLinks, buildViewGraphData, type TreeGraphData } from "../selectors";
import type { NodeId } from "../../../shared/model";
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
  const {
    rootId,
    reachableNodeIds,
    endorsementsReady,
    trustedFilterActive,
    nodesData,
    edgesUnion,
    edgesStrict,
    spouseVersionResolution,
  } = useTreeGraphData();
  const { deduplicateChildren, childrenMode, strictIncludeUnversionedChildren } = useVizOptions();

  const emptyGraph = useMemo<TreeGraphData>(
    () => ({ nodes: [], edges: [], childrenByParent: {} }),
    [],
  );

  const visibleNodeIds = useMemo(
    () => (trustedFilterActive ? new Set(reachableNodeIds) : null),
    [trustedFilterActive, reachableNodeIds],
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
      visibleNodeIds,
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
    visibleNodeIds,
  ]);

  // Per-person co-parent (spouse) node ids for views. Unversioned (v0) references are mapped to the
  // resolved best version from the data layer's resolution cache; until resolution lands they stay
  // at v0 (the view falls back to a short-hash label).
  const spouseLinks = useMemo(() => {
    if (!enabled) return new Map<NodeId, NodeId[]>();
    return buildSpouseLinks({
      graph,
      nodesData,
      resolveVersion: (personHash, rawVersion) =>
        rawVersion > 0
          ? rawVersion
          : (spouseVersionResolution.get(personHash.toLowerCase()) ?? rawVersion),
    });
  }, [enabled, graph, nodesData, spouseVersionResolution]);

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
    spouseLinks,
  };
}
