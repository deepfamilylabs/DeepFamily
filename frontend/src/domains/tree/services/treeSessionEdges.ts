import { parseNodeId, type NodeData, type NodeId } from "../../../shared/model";
import type {
  EdgeStrictEntry,
  EdgeStoreStrict,
  EdgeStoreUnion,
  EdgeUnionEntry,
} from "../model/treeStore";
import { unionParentKey } from "../model/treeStore";
import { addPlaceholderNodes, mergeReachableNodeIds } from "./treeEdgeState";
import { isParentReachable } from "./treeTraversalState";

function isEntryStale(fetchedAt: number | undefined, ttlMs: number): boolean {
  if (!Number.isFinite(fetchedAt)) return true;
  if (ttlMs <= 0) return false;
  return Date.now() - Number(fetchedAt) > ttlMs;
}

export interface TreeSessionEdgeApi {
  listChildrenStrictAll: (
    parentHash: string,
    parentVersionIndex: number,
    options: { pageLimit: number; checkAbort?: () => void },
  ) => Promise<NodeId[]>;
  listChildrenUnionAll: (
    parentHash: string,
    options: {
      pageLimit: number;
      checkAbort?: () => void;
      totalVersionsOptions: {
        ttlMs: number;
        onCacheHit?: () => void;
        onCacheMiss?: () => void;
        onFetched?: () => void;
      };
      onTotalVersions?: (totalVersions: number) => void;
    },
  ) => Promise<{ childIds: NodeId[]; totalVersions: number }>;
}

export function createTreeSessionEdgeLoaders(options: {
  api: TreeSessionEdgeApi | null;
  getEdgesStrict: () => EdgeStoreStrict;
  getEdgesUnion: () => EdgeStoreUnion;
  edgeTtlMs: number;
  totalVersionsTtlMs: number;
  childrenPageLimit: number;
  checkAbort: () => void;
  onStrictFetched?: (fetchedAt: number) => void;
  onUnionFetched?: (fetchedAt: number) => void;
  onTotalVersionsCacheHit?: () => void;
  onTotalVersionsCacheMiss?: () => void;
  onTotalVersionsFetched?: (fetchedAt: number) => void;
  onTotalVersions?: (personHash: string, totalVersions: number) => void;
}) {
  const loadChildrenStrict = async (
    nodeId: NodeId,
    forceRefresh?: boolean,
  ): Promise<EdgeStrictEntry> => {
    const cached = options.getEdgesStrict()[nodeId];
    if (!forceRefresh && cached && !isEntryStale(cached.fetchedAt, options.edgeTtlMs)) {
      return cached;
    }
    if (!options.api) throw new Error("Contract not ready");

    const { personHash, versionIndex } = parseNodeId(nodeId);
    const childIds = await options.api.listChildrenStrictAll(personHash, Number(versionIndex), {
      pageLimit: options.childrenPageLimit,
      checkAbort: options.checkAbort,
    });
    const fetchedAt = Date.now();
    options.onStrictFetched?.(fetchedAt);
    return { childIds, fetchedAt, totalCount: childIds.length };
  };

  const loadChildrenUnion = async (
    personHash: string,
    forceRefresh?: boolean,
  ): Promise<EdgeUnionEntry> => {
    const parentKey = unionParentKey(personHash);
    const cached = options.getEdgesUnion()[parentKey];
    if (!forceRefresh && cached && !isEntryStale(cached.fetchedAt, options.edgeTtlMs)) {
      return cached;
    }
    if (!options.api) throw new Error("Contract not ready");

    options.checkAbort();
    const { childIds, totalVersions } = await options.api.listChildrenUnionAll(personHash, {
      pageLimit: options.childrenPageLimit,
      checkAbort: options.checkAbort,
      totalVersionsOptions: {
        ttlMs: options.totalVersionsTtlMs,
        onCacheHit: options.onTotalVersionsCacheHit,
        onCacheMiss: options.onTotalVersionsCacheMiss,
        onFetched: () => options.onTotalVersionsFetched?.(Date.now()),
      },
      onTotalVersions: (tv) => {
        if (tv > 0) options.onTotalVersions?.(personHash, tv);
      },
    });
    const fetchedAt = Date.now();
    options.onUnionFetched?.(fetchedAt);
    return { childIds, fetchedAt, totalVersions };
  };

  return { loadChildrenStrict, loadChildrenUnion };
}

export function ensureTreeReachableChildren(options: {
  reachableNodeIds: NodeId[];
  parentId: NodeId | null;
  parentHash: string | null;
  childIds: NodeId[];
  setNodesData: (updater: (prev: Record<string, NodeData>) => Record<string, NodeData>) => void;
  setReachableNodeIds: (updater: (prev: NodeId[]) => NodeId[]) => void;
}) {
  if (!options.childIds.length) return;
  if (!isParentReachable(options.reachableNodeIds, options.parentId, options.parentHash)) return;

  options.setNodesData((prev) => addPlaceholderNodes(prev, options.childIds));
  options.setReachableNodeIds((prev) => mergeReachableNodeIds(prev, options.childIds));
}

export function createTreeEdgeRevalidators(options: {
  edgeRevalidate: Set<string>;
  loadChildrenStrict: (nodeId: NodeId, forceRefresh?: boolean) => Promise<EdgeStrictEntry>;
  loadChildrenUnion: (personHash: string, forceRefresh?: boolean) => Promise<EdgeUnionEntry>;
  getReachableNodeIds: () => NodeId[];
  setNodesData: (updater: (prev: Record<string, NodeData>) => Record<string, NodeData>) => void;
  setReachableNodeIds: (updater: (prev: NodeId[]) => NodeId[]) => void;
  setEdgesStrict: (updater: (prev: EdgeStoreStrict) => EdgeStoreStrict) => void;
  setEdgesUnion: (updater: (prev: EdgeStoreUnion) => EdgeStoreUnion) => void;
}) {
  const scheduleRevalidate = (key: string, run: () => Promise<void>) => {
    if (options.edgeRevalidate.has(key)) return;
    options.edgeRevalidate.add(key);
    run()
      .catch(() => {})
      .finally(() => {
        options.edgeRevalidate.delete(key);
      });
  };

  const revalidateStrict = (nodeId: NodeId) => {
    scheduleRevalidate(`strict:${nodeId}`, async () => {
      const entry = await options.loadChildrenStrict(nodeId, true);
      options.setEdgesStrict((prev) => ({ ...prev, [nodeId]: entry }));
      ensureTreeReachableChildren({
        reachableNodeIds: options.getReachableNodeIds(),
        parentId: nodeId,
        parentHash: null,
        childIds: entry.childIds,
        setNodesData: options.setNodesData,
        setReachableNodeIds: options.setReachableNodeIds,
      });
    });
  };

  const revalidateUnion = (personHash: string) => {
    const parentKey = unionParentKey(personHash);
    scheduleRevalidate(`union:${parentKey}`, async () => {
      const entry = await options.loadChildrenUnion(personHash, true);
      options.setEdgesUnion((prev) => ({ ...prev, [parentKey]: entry }));
      ensureTreeReachableChildren({
        reachableNodeIds: options.getReachableNodeIds(),
        parentId: null,
        parentHash: personHash,
        childIds: entry.childIds,
        setNodesData: options.setNodesData,
        setReachableNodeIds: options.setReachableNodeIds,
      });
    });
  };

  return { revalidateStrict, revalidateUnion };
}
