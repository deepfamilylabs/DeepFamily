import { useMemo } from "react";
import { isMetadataUnlockUsable } from "../../../shared/model";
import { useFamilyTreeProjection } from "../context/useFamilyTreeProjection";
import { useTreeGraphData } from "../context/treeContexts";

export interface MetadataUnlockViewScope {
  rootId: string | null;
  key: string;
  nodeIds: ReadonlySet<string>;
}

/** Uses the same root, version and visibility projection as the current family view. */
export function useMetadataUnlockScope({
  includeSpouses = false,
}: { includeSpouses?: boolean } = {}): MetadataUnlockViewScope & { unlockedCount: number } {
  const { rootExists } = useTreeGraphData();
  const { rootId, graph, spouseLinks, nodesData } = useFamilyTreeProjection({
    enabled: rootExists,
  });
  const scope = useMemo<MetadataUnlockViewScope>(() => {
    const nodeIds = new Set<string>();
    if (rootId && rootExists) {
      for (const node of graph.nodes) nodeIds.add(node.id);
      if (includeSpouses) {
        for (const spouses of spouseLinks.values()) {
          for (const id of spouses) nodeIds.add(id);
        }
      }
    }
    // Display enrichment may reorder siblings without changing membership.
    // Keep those changes out of the key used to cancel stale unlock work.
    return { rootId, nodeIds, key: JSON.stringify([rootId, [...nodeIds].sort()]) };
  }, [rootId, rootExists, graph.nodes, spouseLinks, includeSpouses]);
  const unlockedCount = useMemo(
    () => [...scope.nodeIds].filter((id) => isMetadataUnlockUsable(nodesData[id])).length,
    [scope.nodeIds, nodesData],
  );
  return { ...scope, unlockedCount };
}
