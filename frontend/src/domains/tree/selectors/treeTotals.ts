import { makeNodeId, type NodeData } from "../../../types/graph";

export function parseTotalVersionsResult(result: any): number {
  const totalVersions = Number(result?.totalVersions ?? result?.[1] ?? 0);
  if (!Number.isFinite(totalVersions) || totalVersions < 0) return 0;
  return totalVersions;
}

export function applyTotalVersionsToNodes(
  nodesData: Record<string, NodeData>,
  personHash: string,
  totalVersions: number,
  options?: { ensureNode?: { versionIndex: number } },
): Record<string, NodeData> {
  if (!personHash || !Number.isFinite(totalVersions) || totalVersions <= 0) {
    return nodesData;
  }

  const key = personHash.toLowerCase();
  const next = { ...nodesData };
  let changed = false;

  for (const [id, node] of Object.entries(next)) {
    if (node.personHash.toLowerCase() === key && node.totalVersions !== totalVersions) {
      next[id] = { ...node, totalVersions };
      changed = true;
    }
  }

  const ensureVersionIndex = options?.ensureNode?.versionIndex;
  if (Number.isFinite(ensureVersionIndex) && Number(ensureVersionIndex) > 0) {
    const ensuredId = makeNodeId(personHash, Number(ensureVersionIndex));
    const ensuredNode = next[ensuredId];
    if (!ensuredNode) {
      next[ensuredId] = {
        personHash,
        versionIndex: Number(ensureVersionIndex),
        id: ensuredId,
        totalVersions,
      };
      changed = true;
    } else if (ensuredNode.totalVersions !== totalVersions) {
      next[ensuredId] = { ...ensuredNode, totalVersions };
      changed = true;
    }
  }

  return changed ? next : nodesData;
}
