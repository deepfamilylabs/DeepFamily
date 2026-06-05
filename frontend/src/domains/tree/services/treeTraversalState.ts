import { parseNodeId, type NodeData, type NodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";

export function buildTreeFetchRunKey(options: {
  rootId: string;
  childrenMode: string;
  strictIncludeUnversionedChildren: boolean;
  trustedSourceFilterEnabled: boolean;
  traversal: string;
  refreshTick: number;
}): string {
  return `build-${options.rootId}-${options.childrenMode}-${options.strictIncludeUnversionedChildren ? "v0" : "no0"}-${options.trustedSourceFilterEnabled ? "trusted" : "all"}-${options.traversal}-${options.refreshTick}`;
}

export function isParentReachable(
  reachableNodeIds: NodeId[],
  parentId: NodeId | null,
  parentHash: string | null,
): boolean {
  if (reachableNodeIds.length === 0) return false;
  if (parentId) return reachableNodeIds.includes(parentId);
  if (!parentHash) return false;
  const key = parentHash.toLowerCase();
  return reachableNodeIds.some((id) => parseNodeId(id).personHash.toLowerCase() === key);
}

export function applyNodeUpserts(
  nodesData: Record<string, NodeData>,
  nodeUpserts: Record<string, NodeData>,
): Record<string, NodeData> {
  if (Object.keys(nodeUpserts).length === 0) return nodesData;
  const next = { ...nodesData };
  for (const [id, node] of Object.entries(nodeUpserts)) {
    next[id] = next[id] ? { ...node, ...next[id], id } : node;
  }
  return next;
}

export function mergeChildNodeIds(baseChildIds: NodeId[], extraChildIds: NodeId[]): NodeId[] {
  if (extraChildIds.length === 0) return baseChildIds;
  const merged = new Set(baseChildIds);
  for (const id of extraChildIds) merged.add(id);
  const out = Array.from(merged);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function bufferMissingNode(
  nodeUpserts: Record<string, NodeData>,
  existingNodes: Record<string, NodeData>,
  nodeId: NodeId,
): void {
  if (existingNodes[nodeId] || nodeUpserts[nodeId]) return;
  const parsed = parseNodeId(nodeId);
  nodeUpserts[nodeId] = {
    personHash: parsed.personHash,
    versionIndex: Number(parsed.versionIndex),
    id: nodeId,
  };
}

export function pushTraversalChildren(
  frontier: Array<{ id: NodeId; depth: number }>,
  childIds: NodeId[],
  depth: number,
): void {
  for (const id of childIds) frontier.push({ id, depth });
}

export function shouldFlushTraversalWork(
  now: number,
  lastAt: number,
  visitedSize: number,
  options: { intervalMs: number; batchSize: number },
): boolean {
  return now - lastAt > options.intervalMs || visitedSize % options.batchSize === 0;
}

export function createTreeProgress(visitedSize: number, depth: number) {
  return { created: visitedSize, visited: visitedSize, depth };
}

export function snapshotAndClearUpserts<T extends Record<string, any>>(upserts: T): T | null {
  const keys = Object.keys(upserts);
  if (keys.length === 0) return null;
  const snapshot = { ...upserts };
  for (const key of keys) delete upserts[key];
  return snapshot;
}

export function mergeEdgeUpserts<T extends Record<string, any>>(target: T, source: T): void {
  Object.assign(target, source);
}

export function applyEdgeUnionUpserts(
  current: EdgeStoreUnion,
  upserts: EdgeStoreUnion | null,
): EdgeStoreUnion {
  return upserts ? { ...current, ...upserts } : current;
}

export function applyEdgeStrictUpserts(
  current: EdgeStoreStrict,
  upserts: EdgeStoreStrict | null,
): EdgeStoreStrict {
  return upserts ? { ...current, ...upserts } : current;
}
