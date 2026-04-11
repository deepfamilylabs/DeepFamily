import { makeNodeId, parseNodeId, type NodeId } from "../../../types/graph";
import type {
  EdgeStrictEntry,
  EdgeStoreStrict,
  EdgeStoreUnion,
  EdgeUnionEntry,
} from "../../../types/treeStore";
import { unionParentKey } from "../../../types/treeStore";
import { mergeChildNodeIds } from "./treeTraversalState";

function isEntryStale(fetchedAt: number | undefined, ttlMs: number): boolean {
  if (!Number.isFinite(fetchedAt)) return true;
  if (ttlMs <= 0) return false;
  return Date.now() - Number(fetchedAt) > ttlMs;
}

export async function resolveTreeTraversalChildIds(options: {
  nodeId: NodeId;
  childrenMode: "strict" | "union";
  strictIncludeUnversionedChildren: boolean;
  edgeTtlMs: number;
  edgesStrict: EdgeStoreStrict;
  edgesUnion: EdgeStoreUnion;
  loadChildrenStrict: (nodeId: NodeId, forceRefresh?: boolean) => Promise<EdgeStrictEntry>;
  loadChildrenUnion: (personHash: string, forceRefresh?: boolean) => Promise<EdgeUnionEntry>;
  onStrictCacheHit?: () => void;
  onStrictCacheMiss?: () => void;
  onUnionCacheHit?: () => void;
  onUnionCacheMiss?: () => void;
  onStrictStale?: (nodeId: NodeId) => void;
  onUnionStale?: (personHash: string) => void;
}): Promise<{
  childIds: NodeId[];
  strictUpserts: EdgeStoreStrict;
  unionUpserts: EdgeStoreUnion;
}> {
  const strictUpserts: EdgeStoreStrict = {};
  const unionUpserts: EdgeStoreUnion = {};

  if (options.childrenMode === "strict") {
    let entry: EdgeStrictEntry;
    const cached = options.edgesStrict[options.nodeId];
    if (cached) {
      options.onStrictCacheHit?.();
      if (isEntryStale(cached.fetchedAt, options.edgeTtlMs)) {
        options.onStrictStale?.(options.nodeId);
      }
      entry = cached;
    } else {
      options.onStrictCacheMiss?.();
      entry = await options.loadChildrenStrict(options.nodeId, true);
      strictUpserts[options.nodeId] = entry;
    }

    let childIds = entry.childIds;
    if (options.strictIncludeUnversionedChildren) {
      const { personHash } = parseNodeId(options.nodeId);
      const zeroKey = makeNodeId(personHash, 0);
      let zeroEntry: EdgeStrictEntry;
      const cachedZero = options.edgesStrict[zeroKey];
      if (cachedZero) {
        options.onStrictCacheHit?.();
        if (isEntryStale(cachedZero.fetchedAt, options.edgeTtlMs)) {
          options.onStrictStale?.(zeroKey);
        }
        zeroEntry = cachedZero;
      } else {
        options.onStrictCacheMiss?.();
        zeroEntry = await options.loadChildrenStrict(zeroKey, true);
        strictUpserts[zeroKey] = zeroEntry;
      }
      if (zeroEntry.childIds.length) {
        childIds = mergeChildNodeIds(childIds, zeroEntry.childIds);
      }
    }

    return { childIds, strictUpserts, unionUpserts };
  }

  const { personHash } = parseNodeId(options.nodeId);
  const parentKey = unionParentKey(personHash);
  let entry: EdgeUnionEntry;
  const cached = options.edgesUnion[parentKey];
  if (cached) {
    options.onUnionCacheHit?.();
    if (isEntryStale(cached.fetchedAt, options.edgeTtlMs)) {
      options.onUnionStale?.(personHash);
    }
    entry = cached;
  } else {
    options.onUnionCacheMiss?.();
    entry = await options.loadChildrenUnion(personHash, true);
    unionUpserts[parentKey] = entry;
  }

  return { childIds: entry.childIds, strictUpserts, unionUpserts };
}
