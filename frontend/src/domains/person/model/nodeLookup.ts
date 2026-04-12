import type { NodeData } from "../../../shared/model";

export function findNodeEntryByTokenId(
  nodesData: Record<string, NodeData>,
  tokenId: string,
): [string, NodeData] | undefined {
  const normalizedTokenId = String(tokenId);
  for (const [id, node] of Object.entries(nodesData)) {
    if (node.tokenId && String(node.tokenId) === normalizedTokenId) {
      return [id, node];
    }
  }
  return undefined;
}

export function findNodeIdByTokenId(
  nodesData: Record<string, NodeData>,
  tokenId: string,
): string | undefined {
  return findNodeEntryByTokenId(nodesData, tokenId)?.[0];
}

export function findNodeByTokenId(
  nodesData: Record<string, NodeData>,
  tokenId: string,
): NodeData | undefined {
  return findNodeEntryByTokenId(nodesData, tokenId)?.[1];
}
