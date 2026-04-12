import { parseNodeId, type NodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import { collectReachableHashes, collectStrictParentIds } from "./treeEdgeState";

export interface TreeEdgeRefreshInvalidation {
  totalVersionsKeys: string[];
  unionKeys: string[];
  strictKeys: string[];
  strictPrefixes: string[];
}

export interface TreeEdgeRefreshApi {
  listChildrenUnionAll: (
    parentHash: string,
    options: {
      pageLimit: number;
      totalVersionsOptions: { ttlMs: number };
      onTotalVersions?: (totalVersions: number) => void;
    },
  ) => Promise<{ childIds: NodeId[]; totalVersions: number }>;
  listChildrenStrictAll: (
    parentHash: string,
    parentVersionIndex: number,
    options: { pageLimit: number },
  ) => Promise<NodeId[]>;
}

export interface TreeEdgeRefreshResult {
  unionUpserts: EdgeStoreUnion;
  strictUpserts: EdgeStoreStrict;
  newReachableChildren: NodeId[];
}

export async function reloadInvalidatedTreeEdges(options: {
  api: TreeEdgeRefreshApi;
  invalidation: TreeEdgeRefreshInvalidation;
  reachableNodeIds: NodeId[];
  edgesStrict: EdgeStoreStrict;
  childrenPageLimit: number;
  totalVersionsTtlMs: number;
  onTotalVersions?: (personHash: string, totalVersions: number) => void;
}): Promise<TreeEdgeRefreshResult> {
  const reachableIds = new Set(options.reachableNodeIds);
  const reachableHashes = collectReachableHashes(options.reachableNodeIds);
  const strictIds = collectStrictParentIds({
    strictKeys: options.invalidation.strictKeys,
    strictPrefixes: options.invalidation.strictPrefixes,
    edgesStrict: options.edgesStrict,
  });

  const unionUpserts: EdgeStoreUnion = {};
  const strictUpserts: EdgeStoreStrict = {};
  const newReachableChildren = new Set<NodeId>();

  for (const parentHashLower of options.invalidation.unionKeys) {
    if (!reachableHashes.has(parentHashLower)) continue;
    try {
      const { childIds, totalVersions } = await options.api.listChildrenUnionAll(parentHashLower, {
        pageLimit: options.childrenPageLimit,
        totalVersionsOptions: { ttlMs: options.totalVersionsTtlMs },
        onTotalVersions: (tv) => {
          if (tv > 0) options.onTotalVersions?.(parentHashLower, tv);
        },
      });
      unionUpserts[parentHashLower] = { childIds, fetchedAt: Date.now(), totalVersions };
      for (const childId of childIds) newReachableChildren.add(childId);
    } catch {
      // ignore individual reload failure and let caller continue
    }
  }

  for (const parentId of strictIds) {
    if (!reachableIds.has(parentId)) continue;
    try {
      const { personHash, versionIndex } = parseNodeId(parentId);
      const childIds = await options.api.listChildrenStrictAll(personHash, Number(versionIndex), {
        pageLimit: options.childrenPageLimit,
      });
      strictUpserts[parentId] = {
        childIds,
        fetchedAt: Date.now(),
        totalCount: childIds.length,
      };
      for (const childId of childIds) newReachableChildren.add(childId);
    } catch {
      // ignore individual reload failure and let caller continue
    }
  }

  return {
    unionUpserts,
    strictUpserts,
    newReachableChildren: Array.from(newReachableChildren),
  };
}
