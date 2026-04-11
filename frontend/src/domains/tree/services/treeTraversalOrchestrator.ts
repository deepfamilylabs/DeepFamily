import type { NodeData, NodeId } from "../../../types/graph";
import type {
  EdgeStrictEntry,
  EdgeStoreStrict,
  EdgeStoreUnion,
  EdgeUnionEntry,
} from "../../../types/treeStore";
import {
  applyEdgeStrictUpserts,
  applyEdgeUnionUpserts,
  applyNodeUpserts,
  bufferMissingNode,
  createTreeProgress,
  mergeEdgeUpserts,
  pushTraversalChildren,
  shouldFlushTraversalWork,
  snapshotAndClearUpserts,
} from "./treeTraversalState";
import { resolveTreeTraversalChildIds } from "./treeTraversalStep";

export interface TreeBuildSessionProgress {
  created: number;
  visited: number;
  depth: number;
}

export interface TreeBuildSessionOptions {
  rootId: NodeId;
  traversal: string;
  childrenMode: "strict" | "union";
  strictIncludeUnversionedChildren: boolean;
  hardNodeLimit: number;
  edgeTtlMs: number;
  getCurrentNodes: () => Record<string, NodeData>;
  getCurrentEdgesStrict: () => EdgeStoreStrict;
  getCurrentEdgesUnion: () => EdgeStoreUnion;
  loadChildrenStrict: (nodeId: NodeId, forceRefresh?: boolean) => Promise<EdgeStrictEntry>;
  loadChildrenUnion: (personHash: string, forceRefresh?: boolean) => Promise<EdgeUnionEntry>;
  checkAbort: () => void;
  onStrictCacheHit?: () => void;
  onStrictCacheMiss?: () => void;
  onUnionCacheHit?: () => void;
  onUnionCacheMiss?: () => void;
  onStrictStale?: (nodeId: NodeId) => void;
  onUnionStale?: (personHash: string) => void;
  onProgress?: (progress: TreeBuildSessionProgress) => void;
  onCommitNodes?: (nodes: Record<string, NodeData>) => void;
  onCommitEdgesUnion?: (edges: EdgeStoreUnion) => void;
  onCommitEdgesStrict?: (edges: EdgeStoreStrict) => void;
  flushIntervalMs?: number;
  flushBatchSize?: number;
  now?: () => number;
}

export interface TreeBuildSessionResult {
  visitedIds: NodeId[];
  progress: TreeBuildSessionProgress;
}

export async function runTreeBuildSession(
  options: TreeBuildSessionOptions,
): Promise<TreeBuildSessionResult> {
  const visited = new Set<NodeId>();
  const frontier: Array<{ id: NodeId; depth: number }> = [{ id: options.rootId, depth: 1 }];
  let maxDepthSeen = 1;
  const now = options.now ?? (() => performance.now());
  let lastEmit = now();
  let lastCommit = lastEmit;
  const flushIntervalMs = options.flushIntervalMs ?? 60;
  const flushBatchSize = options.flushBatchSize ?? 50;

  const nodeUpserts: Record<string, NodeData> = {};
  const unionUpserts: EdgeStoreUnion = {};
  const strictUpserts: EdgeStoreStrict = {};

  const commit = () => {
    const nodeSnapshot = snapshotAndClearUpserts(nodeUpserts);
    const unionSnapshot = snapshotAndClearUpserts(unionUpserts);
    const strictSnapshot = snapshotAndClearUpserts(strictUpserts);

    if (nodeSnapshot) options.onCommitNodes?.(nodeSnapshot);
    if (unionSnapshot) options.onCommitEdgesUnion?.(unionSnapshot);
    if (strictSnapshot) options.onCommitEdgesStrict?.(strictSnapshot);
  };

  while (frontier.length && visited.size < options.hardNodeLimit) {
    options.checkAbort();
    const next = options.traversal === "bfs" ? frontier.shift() : frontier.pop();
    if (!next) break;

    const { id, depth } = next;
    if (visited.has(id)) continue;
    visited.add(id);
    maxDepthSeen = Math.max(maxDepthSeen, depth);
    bufferMissingNode(nodeUpserts, options.getCurrentNodes(), id);

    const { childIds, strictUpserts: nextStrict, unionUpserts: nextUnion } =
      await resolveTreeTraversalChildIds({
        nodeId: id,
        childrenMode: options.childrenMode,
        strictIncludeUnversionedChildren: options.strictIncludeUnversionedChildren,
        edgeTtlMs: options.edgeTtlMs,
        edgesStrict: options.getCurrentEdgesStrict(),
        edgesUnion: options.getCurrentEdgesUnion(),
        loadChildrenStrict: options.loadChildrenStrict,
        loadChildrenUnion: options.loadChildrenUnion,
        onStrictCacheHit: options.onStrictCacheHit,
        onStrictCacheMiss: options.onStrictCacheMiss,
        onUnionCacheHit: options.onUnionCacheHit,
        onUnionCacheMiss: options.onUnionCacheMiss,
        onStrictStale: options.onStrictStale,
        onUnionStale: options.onUnionStale,
      });

    mergeEdgeUpserts(strictUpserts, nextStrict);
    mergeEdgeUpserts(unionUpserts, nextUnion);

    for (const childId of childIds) {
      bufferMissingNode(nodeUpserts, options.getCurrentNodes(), childId);
    }
    pushTraversalChildren(frontier, childIds, depth + 1);

    const currentTime = now();
    if (
      shouldFlushTraversalWork(currentTime, lastEmit, visited.size, {
        intervalMs: flushIntervalMs,
        batchSize: flushBatchSize,
      })
    ) {
      options.onProgress?.(createTreeProgress(visited.size, maxDepthSeen));
      lastEmit = currentTime;
    }
    if (
      shouldFlushTraversalWork(currentTime, lastCommit, visited.size, {
        intervalMs: flushIntervalMs,
        batchSize: flushBatchSize,
      })
    ) {
      commit();
      lastCommit = currentTime;
    }
  }

  commit();
  return {
    visitedIds: Array.from(visited),
    progress: createTreeProgress(visited.size, maxDepthSeen),
  };
}

export function applyTreeBuildNodeSnapshots(
  nodesData: Record<string, NodeData>,
  nodeUpserts: Record<string, NodeData>,
): Record<string, NodeData> {
  return applyNodeUpserts(nodesData, nodeUpserts);
}

export function applyTreeBuildUnionSnapshots(
  edgesUnion: EdgeStoreUnion,
  unionUpserts: EdgeStoreUnion,
): EdgeStoreUnion {
  return applyEdgeUnionUpserts(edgesUnion, unionUpserts);
}

export function applyTreeBuildStrictSnapshots(
  edgesStrict: EdgeStoreStrict,
  strictUpserts: EdgeStoreStrict,
): EdgeStoreStrict {
  return applyEdgeStrictUpserts(edgesStrict, strictUpserts);
}
