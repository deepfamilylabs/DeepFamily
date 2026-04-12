import type { NodeId, NodeData } from "../../../shared/model";
import type { EdgeStoreStrict, EdgeStoreUnion } from "../model/treeStore";
import {
  getProjectedChildIds,
  type TreeGraphData,
} from "./buildViewGraph";

export type TreeRow = {
  nodeId: NodeId;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
};

export function buildTreeRows(params: {
  rootId: NodeId;
  expanded: Set<NodeId>;
  childrenMode: "union" | "strict";
  strictIncludeUnversionedChildren?: boolean;
  deduplicateChildren: boolean;
  endorsementsReady: boolean;
  nodesData: Record<string, NodeData>;
  edgesUnion: EdgeStoreUnion;
  edgesStrict: EdgeStoreStrict;
}): TreeRow[] {
  const {
    rootId,
    expanded,
    childrenMode,
    strictIncludeUnversionedChildren,
    deduplicateChildren,
    endorsementsReady,
    nodesData,
    edgesUnion,
    edgesStrict,
  } = params;

  const rows: TreeRow[] = [];
  const childCache = new Map<NodeId, NodeId[]>();
  const seen = new Set<NodeId>();

  const getChildren = (id: NodeId): NodeId[] => {
    const cached = childCache.get(id);
    if (cached) return cached;
    const nextChildren = getProjectedChildIds({
      parentId: id,
      childrenMode,
      strictIncludeUnversionedChildren,
      deduplicateChildren,
      endorsementsReady,
      nodesData,
      edgesUnion,
      edgesStrict,
    });
    childCache.set(id, nextChildren);
    return nextChildren;
  };

  const stack: Array<{ id: NodeId; depth: number; isLast: boolean }> = [
    { id: rootId, depth: 0, isLast: true },
  ];

  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    const children = getChildren(current.id);
    rows.push({
      nodeId: current.id,
      depth: current.depth,
      isLast: current.isLast,
      hasChildren: children.length > 0,
    });
    if (!expanded.has(current.id) || !children.length) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({
        id: children[i],
        depth: current.depth + 1,
        isLast: i === children.length - 1,
      });
    }
  }

  return rows;
}

export function buildTreeRowsFromGraph(params: {
  rootId: NodeId;
  expanded: Set<NodeId>;
  graph: TreeGraphData;
}): TreeRow[] {
  const { rootId, expanded, graph } = params;
  const rows: TreeRow[] = [];
  const seen = new Set<NodeId>();
  const stack: Array<{ id: NodeId; depth: number; isLast: boolean }> = [
    { id: rootId, depth: 0, isLast: true },
  ];

  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    const children = graph.childrenByParent[current.id] || [];
    rows.push({
      nodeId: current.id,
      depth: current.depth,
      isLast: current.isLast,
      hasChildren: children.length > 0,
    });
    if (!expanded.has(current.id) || !children.length) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({
        id: children[i],
        depth: current.depth + 1,
        isLast: i === children.length - 1,
      });
    }
  }

  return rows;
}
