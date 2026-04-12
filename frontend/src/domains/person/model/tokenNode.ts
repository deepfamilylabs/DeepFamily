import { makeNodeId, type NodeData } from "../../../shared/model";
import type { ParsedNftDetails } from "../api/personDetailParsers";
import { findNodeEntryByTokenId, findNodeIdByTokenId } from "./nodeLookup";
import { buildNftDetailsPatch } from "./nodeEnrichment";

const EMPTY_STORY_METADATA = {
  totalChunks: 0,
  totalLength: 0,
  isSealed: false,
  lastUpdateTime: 0,
  fullStoryHash: "",
};

export function buildNodeFromNftDetails(tokenId: string, nftRet: ParsedNftDetails): NodeData {
  const id = makeNodeId(nftRet.personHash, Number(nftRet.versionIndex));
  return {
    personHash: nftRet.personHash,
    versionIndex: Number(nftRet.versionIndex),
    id,
    ...buildNftDetailsPatch({
      tokenId: String(tokenId),
      nftRet,
      storyMetadata: EMPTY_STORY_METADATA,
    }),
  };
}

export function backfillPersistedTokenNode(
  nodesData: Record<string, NodeData>,
  entry: [string, NodeData] | undefined,
): Record<string, NodeData> {
  if (!entry) return nodesData;
  const [id, node] = entry;
  if (nodesData[id]) return nodesData;
  return { ...nodesData, [id]: node };
}

export function applyOwnerToTokenNode(
  nodesData: Record<string, NodeData>,
  tokenId: string,
  owner: string,
): Record<string, NodeData> {
  const foundId = findNodeIdByTokenId(nodesData, tokenId);
  if (!foundId) return nodesData;
  const current = nodesData[foundId];
  if (!current || current.owner === owner) return nodesData;
  return { ...nodesData, [foundId]: { ...current, owner } };
}

export function getOwnerFromTokenNode(
  nodesData: Record<string, NodeData>,
  tokenId: string,
): string | null {
  return findNodeEntryByTokenId(nodesData, tokenId)?.[1].owner ?? null;
}
