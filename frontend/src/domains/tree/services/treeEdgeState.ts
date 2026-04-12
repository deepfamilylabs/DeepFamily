import { makeNodeId, parseNodeId, type NodeData, type NodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";

export function collectReachableHashes(reachableNodeIds: NodeId[]): Set<string> {
  return new Set(reachableNodeIds.map((id) => parseNodeId(id).personHash.toLowerCase()));
}

export function collectStrictParentIds(options: {
  strictKeys: string[];
  strictPrefixes: string[];
  edgesStrict: EdgeStoreStrict;
}): Set<NodeId> {
  const strictIds = new Set<NodeId>(options.strictKeys as NodeId[]);
  for (const prefix of options.strictPrefixes) {
    const prefixLower = prefix.toLowerCase();
    for (const key of Object.keys(options.edgesStrict)) {
      if (key.toLowerCase().startsWith(prefixLower)) strictIds.add(key as NodeId);
    }
  }
  return strictIds;
}

export function removeUnionEdges(edgesUnion: EdgeStoreUnion, unionKeys: string[]): EdgeStoreUnion {
  if (unionKeys.length === 0) return edgesUnion;
  const next = { ...edgesUnion };
  let changed = false;
  for (const key of unionKeys) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : edgesUnion;
}

export function removeStrictEdges(options: {
  edgesStrict: EdgeStoreStrict;
  strictKeys: string[];
  strictPrefixes: string[];
}): EdgeStoreStrict {
  if (options.strictKeys.length === 0 && options.strictPrefixes.length === 0) {
    return options.edgesStrict;
  }
  const next = { ...options.edgesStrict };
  let changed = false;
  for (const key of options.strictKeys) {
    if (key in next) {
      delete next[key as NodeId];
      changed = true;
    }
  }
  for (const prefix of options.strictPrefixes) {
    const prefixLower = prefix.toLowerCase();
    for (const key of Object.keys(next)) {
      if (key.toLowerCase().startsWith(prefixLower)) {
        delete next[key as NodeId];
        changed = true;
      }
    }
  }
  return changed ? next : options.edgesStrict;
}

export function addPlaceholderNodes(
  nodesData: Record<string, NodeData>,
  nodeIds: Iterable<NodeId>,
): Record<string, NodeData> {
  const next = { ...nodesData };
  let changed = false;
  for (const id of nodeIds) {
    if (next[id]) continue;
    const parsed = parseNodeId(id);
    next[id] = {
      personHash: parsed.personHash,
      versionIndex: Number(parsed.versionIndex),
      id,
    };
    changed = true;
  }
  return changed ? next : nodesData;
}

export function mergeReachableNodeIds(prev: NodeId[], nextIds: Iterable<NodeId>): NodeId[] {
  const next = new Set(prev);
  let changed = false;
  for (const id of nextIds) {
    if (next.has(id)) continue;
    next.add(id);
    changed = true;
  }
  return changed ? Array.from(next) : prev;
}

export function zeroVersionDetailFetchTimes(
  nodesData: Record<string, NodeData>,
  versionDetailKeys: string[],
): Record<string, NodeData> {
  if (versionDetailKeys.length === 0) return nodesData;
  const staleIds = versionDetailKeys
    .map((key) => {
      const parts = String(key || "").split(":");
      if (parts.length !== 3 || parts[0] !== "vd") return null;
      const hashLower = String(parts[1] || "").toLowerCase();
      const versionIndex = Number(parts[2]);
      if (!hashLower || !Number.isFinite(versionIndex) || versionIndex <= 0) return null;
      return makeNodeId(hashLower, versionIndex);
    })
    .filter(Boolean) as string[];

  if (staleIds.length === 0) return nodesData;
  const next = { ...nodesData };
  let changed = false;
  for (const id of staleIds) {
    const current = next[id];
    if (!current?.versionDetailsFetchedAt) continue;
    next[id] = { ...current, versionDetailsFetchedAt: 0 };
    changed = true;
  }
  return changed ? next : nodesData;
}
