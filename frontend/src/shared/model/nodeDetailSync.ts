import { makeNodeId, type NodeData } from "./graph";
import type { ParsedNftDetails, ParsedVersionDetails } from "./personDetailParsers";
import {
  applyNodeEnrichmentPatches,
  buildNftDetailsPatch,
  buildVersionDetailsPatch,
} from "./nodeEnrichment";
import { applySingleNodePatch } from "./nodeState";
import type { StoryDataResult } from "./storyData";

export interface NodeKeyMinimal {
  personHash: string;
  versionIndex: number;
}

export const EMPTY_STORY_METADATA = {
  totalChunks: 0,
  totalLength: 0,
  isSealed: false,
  lastUpdateTime: 0,
  fullStoryHash: "",
};

export function resolveSelectedNodeData(
  nodesData: Record<string, NodeData>,
  selected: NodeKeyMinimal | null,
): NodeData | null {
  if (!selected) return null;
  return nodesData[makeNodeId(selected.personHash, selected.versionIndex)] || null;
}

export function resolveNodeDetailTokenId(
  versionTokenId: string | null | undefined,
  selectedNodeTokenId: string | null | undefined,
): string | null {
  const tokenId = versionTokenId || selectedNodeTokenId || null;
  return tokenId && tokenId !== "0" ? tokenId : null;
}

export function applyNodeDetailVersionDetails(options: {
  nodesData: Record<string, NodeData>;
  selected: NodeKeyMinimal;
  parsed: ParsedVersionDetails;
  fetchedAt: number;
}): Record<string, NodeData> {
  const { nodesData, selected, parsed, fetchedAt } = options;
  const id = makeNodeId(selected.personHash, selected.versionIndex);
  const current = nodesData[id];
  const patch = buildVersionDetailsPatch({
    id,
    original: { h: selected.personHash, v: selected.versionIndex },
    parsed,
    current: current ?? undefined,
    versionDetailsFetchedAt: fetchedAt,
  });
  return applyNodeEnrichmentPatches(nodesData, [{ id, patch }]);
}

export function applyNodeDetailNftDetails(options: {
  nodesData: Record<string, NodeData>;
  selected: NodeKeyMinimal;
  tokenId: string;
  nftDetails: ParsedNftDetails;
  storyData?: StoryDataResult | null;
}): Record<string, NodeData> {
  const { nodesData, selected, tokenId, nftDetails, storyData } = options;
  const id = makeNodeId(selected.personHash, selected.versionIndex);
  const current = nodesData[id];
  const storyMetadata = storyData?.metadata ?? current?.storyMetadata ?? EMPTY_STORY_METADATA;
  const nftPatch = buildNftDetailsPatch({
    current: current ?? undefined,
    tokenId,
    nftRet: nftDetails,
    storyMetadata,
  });
  const storyFields = storyData
    ? {
        storyMetadata: storyData.metadata,
        storyChunks: storyData.chunks,
        storyFetchedAt: storyData.fetchedAt,
      }
    : {};
  return applySingleNodePatch(nodesData, id, { ...nftPatch, ...storyFields });
}
