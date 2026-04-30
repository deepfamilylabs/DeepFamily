import { makeNodeId, type NodeData } from "./graph";

export function applySingleNodePatch(
  nodesData: Record<string, NodeData>,
  nodeId: string,
  patch: Partial<NodeData>,
): Record<string, NodeData> {
  const current = nodesData[nodeId];
  if (!current) return nodesData;
  return {
    ...nodesData,
    [nodeId]: {
      ...current,
      ...patch,
    },
  };
}

export function upsertNode(
  nodesData: Record<string, NodeData>,
  node: NodeData,
): Record<string, NodeData> {
  return {
    ...nodesData,
    [node.id]: {
      ...(nodesData[node.id] || node),
      ...node,
    },
  };
}

export function bumpNodeEndorsementCount(
  nodesData: Record<string, NodeData>,
  personHash: string,
  versionIndex: number,
  delta: number = 1,
): Record<string, NodeData> {
  if (!personHash || !Number.isFinite(Number(versionIndex))) return nodesData;
  let changed = false;
  const next: Record<string, NodeData> = {};
  for (const [id, node] of Object.entries(nodesData)) {
    if (node.personHash === personHash && Number(node.versionIndex) === Number(versionIndex)) {
      const current = node.endorsementCount ?? 0;
      next[id] = { ...node, endorsementCount: current + delta };
      changed = true;
    } else {
      next[id] = node;
    }
  }
  if (!changed) {
    const nodeId = makeNodeId(personHash, Number(versionIndex));
    const existing = nodesData[nodeId];
    next[nodeId] = existing
      ? { ...existing, endorsementCount: (existing.endorsementCount ?? 0) + delta }
      : {
          personHash,
          versionIndex: Number(versionIndex),
          id: nodeId,
          endorsementCount: delta,
        };
    changed = true;
  }
  return changed ? next : nodesData;
}
