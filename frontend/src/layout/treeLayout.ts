import type { NodeId } from "../types/graph";
import { parseNodeId } from "../types/graph";
import type { PositionedEdge, PositionedNode } from "../types/familyTreeTypes";
import type { TreeGraphData } from "../utils/treeData";

export type TreePositionedNode = PositionedNode;
export type TreePositionedEdge = PositionedEdge;

export type TreeLayoutConfig = {
  baseNodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  marginX: number;
  marginY: number;
};

export function computeTreeLayout(
  graph: TreeGraphData,
  rootId: NodeId | null,
  cfg: TreeLayoutConfig,
) {
  const { baseNodeWidth, nodeHeight, gapX, gapY, marginX, marginY } = cfg;
  const nodes: TreePositionedNode[] = [];
  const edges: TreePositionedEdge[] = [];
  if (!rootId) return { nodes, edges, width: 0, height: 0 };
  let nextLeafIndex = 0;
  let maxDepthSeen = 0;
  const unitWidth = baseNodeWidth + gapX;
  const visited = new Set<NodeId>();

  function layout(id: NodeId, depth: number): { x: number; y: number } | null {
    if (visited.has(id)) return null;
    visited.add(id);
    maxDepthSeen = Math.max(maxDepthSeen, depth);
    const children = graph.childrenByParent[id] || [];
    const childPositions: Array<{ id: NodeId; pos: { x: number; y: number } }> = [];
    for (const cid of children) {
      const pos = layout(cid, depth + 1);
      if (pos) {
        childPositions.push({ id: cid, pos });
        edges.push({ from: id, to: cid });
      }
    }
    let x: number;
    const y = marginY + depth * gapY;
    if (childPositions.length === 0) {
      x = nextLeafIndex * unitWidth;
      nextLeafIndex += 1;
    } else {
      const minX = childPositions[0].pos.x;
      const maxX = childPositions[childPositions.length - 1].pos.x;
      x = (minX + maxX) / 2;
    }
    const parsed = parseNodeId(id);
    nodes.push({
      id,
      depth,
      personHash: parsed.personHash,
      versionIndex: parsed.versionIndex,
      x,
      y,
    });
    return { x, y };
  }

  layout(rootId, 0);
  if (nodes.length === 0) return { nodes, edges, width: 0, height: 0 };
  let minX = Infinity,
    maxX = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
  }
  const offsetX = marginX - minX;
  for (const n of nodes) n.x += offsetX;
  const width = maxX - minX + baseNodeWidth + marginX * 2;
  const height = marginY * 2 + maxDepthSeen * gapY + nodeHeight;
  return { nodes, edges, width, height };
}
