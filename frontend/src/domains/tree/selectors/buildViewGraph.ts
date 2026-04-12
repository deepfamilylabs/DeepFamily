import type { NodeId, NodeData } from "../../../shared/model";
import { makeNodeId, parseNodeId } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import { unionParentKey } from "../model/treeStore";
import type { BaseEdge, BaseNode } from "../model/familyTreeTypes";

export type TreeGraphData = {
  nodes: BaseNode[];
  edges: BaseEdge[];
  childrenByParent: Record<NodeId, NodeId[]>;
};

export type TreeWalkParams = {
  rootId: NodeId | null;
  childrenMode: "union" | "strict";
  strictIncludeUnversionedChildren?: boolean;
  deduplicateChildren: boolean;
  endorsementsReady: boolean;
  nodesData: Record<string, NodeData>;
  edgesUnion: EdgeStoreUnion;
  edgesStrict: EdgeStoreStrict;
};

function chooseBestVersion(
  ids: NodeId[],
  nodesData: Record<string, NodeData>,
  endorsementsReady: boolean,
): NodeId {
  if (!endorsementsReady) {
    return ids.reduce(
      (best, current) =>
        parseNodeId(current).versionIndex < parseNodeId(best).versionIndex ? current : best,
      ids[0],
    );
  }

  let best = ids[0];
  let bestCount = nodesData[best]?.endorsementCount ?? 0;
  let bestVersion = parseNodeId(best).versionIndex;

  for (let i = 1; i < ids.length; i++) {
    const id = ids[i];
    const count = nodesData[id]?.endorsementCount ?? 0;
    const version = parseNodeId(id).versionIndex;
    if (count > bestCount || (count === bestCount && version < bestVersion)) {
      best = id;
      bestCount = count;
      bestVersion = version;
    }
  }

  return best;
}

function projectDeduplicatedChildIds(
  raw: NodeId[],
  nodesData: Record<string, NodeData>,
  endorsementsReady: boolean,
): NodeId[] {
  if (raw.length <= 1) return raw;

  const byHash = new Map<string, NodeId[]>();
  for (const id of raw) {
    const key = parseNodeId(id).personHash.toLowerCase();
    const current = byHash.get(key);
    if (current) current.push(id);
    else byHash.set(key, [id]);
  }

  if (byHash.size === raw.length) return raw;

  const bestByHash = new Map<string, NodeId>();
  for (const [key, ids] of byHash.entries()) {
    bestByHash.set(
      key,
      ids.length === 1 ? ids[0] : chooseBestVersion(ids, nodesData, endorsementsReady),
    );
  }

  const out: NodeId[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const key = parseNodeId(id).personHash.toLowerCase();
    if (seen.has(key)) continue;
    const best = bestByHash.get(key);
    if (best) out.push(best);
    seen.add(key);
  }

  return out;
}

export function getProjectedChildIds(params: {
  parentId: NodeId;
  childrenMode: "union" | "strict";
  strictIncludeUnversionedChildren?: boolean;
  deduplicateChildren: boolean;
  endorsementsReady: boolean;
  nodesData: Record<string, NodeData>;
  edgesUnion: EdgeStoreUnion;
  edgesStrict: EdgeStoreStrict;
}): NodeId[] {
  const {
    parentId,
    childrenMode,
    strictIncludeUnversionedChildren,
    deduplicateChildren,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict,
  } = params;

  const { personHash } = parseNodeId(parentId);
  const raw =
    childrenMode === "strict"
      ? (() => {
          const base = edgesStrict[parentId]?.childIds || [];
          if (!strictIncludeUnversionedChildren) return base;
          const unversioned = edgesStrict[makeNodeId(personHash, 0)]?.childIds || [];
          if (!unversioned.length) return base;
          const merged = new Set(base);
          for (const childId of unversioned) merged.add(childId);
          return Array.from(merged).sort((a, b) => a.localeCompare(b));
        })()
      : edgesUnion[unionParentKey(personHash)]?.childIds || [];

  const filtered = raw.filter((id) => id !== parentId);
  if (!deduplicateChildren) return filtered;
  return projectDeduplicatedChildIds(filtered, nodesData, endorsementsReady);
}

function walkTree(params: TreeWalkParams): TreeGraphData {
  const {
    rootId,
    childrenMode,
    strictIncludeUnversionedChildren,
    deduplicateChildren,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict,
  } = params;

  if (!rootId) return { nodes: [], edges: [], childrenByParent: {} };

  const nodes: BaseNode[] = [];
  const edges: BaseEdge[] = [];
  const childrenByParent: Record<NodeId, NodeId[]> = {};
  const visited = new Set<NodeId>();
  const stack: Array<{ id: NodeId; depth: number; parentId?: NodeId }> = [{ id: rootId, depth: 0 }];

  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current.id)) continue;

    visited.add(current.id);
    const parsed = parseNodeId(current.id);
    nodes.push({
      id: current.id,
      depth: current.depth,
      personHash: parsed.personHash,
      versionIndex: parsed.versionIndex,
    });

    if (current.parentId) {
      edges.push({ from: current.parentId, to: current.id });
    }

    const children = getProjectedChildIds({
      parentId: current.id,
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict,
    });

    if (children.length) childrenByParent[current.id] = children;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ id: children[i], depth: current.depth + 1, parentId: current.id });
    }
  }

  return { nodes, edges, childrenByParent };
}

export function buildViewGraphData(params: TreeWalkParams): TreeGraphData {
  return walkTree(params);
}
