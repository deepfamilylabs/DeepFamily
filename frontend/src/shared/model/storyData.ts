import { ethers } from "ethers";
import { computeStoryHash } from "./story";
import type { NodeData, StoryChunk, StoryMetadata } from "./graph";

export interface StoryIntegrity {
  missing: number[];
  lengthMatch: boolean;
  hashMatch: boolean | null;
  computedLength: number;
  computedHash?: string;
}

export interface StorySnapshot {
  chunks: StoryChunk[];
  fullStory: string;
  integrity: StoryIntegrity;
}

export interface StoryDataResult {
  chunks: StoryChunk[];
  fullStory: string;
  integrity: StoryIntegrity;
  metadata: StoryMetadata;
  loading: false;
  fetchedAt: number;
}

export function parseStoryChunkRecord(chunk: any): StoryChunk {
  return {
    chunkIndex: Number(chunk?.chunkIndex ?? chunk?.[0] ?? 0),
    chunkHash: String(chunk?.chunkHash ?? chunk?.[1] ?? ethers.ZeroHash),
    content: String(chunk?.content ?? chunk?.[2] ?? ""),
    timestamp: Number(chunk?.timestamp ?? chunk?.[3] ?? 0),
    editor: String(chunk?.editor ?? chunk?.[4] ?? ethers.ZeroAddress),
    chunkType: Number(chunk?.chunkType ?? chunk?.[5] ?? 0),
    attachmentCID: String(chunk?.attachmentCID ?? chunk?.[6] ?? ""),
  };
}

export function buildStorySnapshot(
  chunks: StoryChunk[],
  metadata?: StoryMetadata | null,
): StorySnapshot {
  const sorted = [...chunks]
    .filter((chunk) => Number.isFinite(Number(chunk?.chunkIndex)))
    .sort((a, b) => a.chunkIndex - b.chunkIndex);
  const fullStory = sorted.map((chunk) => chunk.content).join("");
  const encoder = new TextEncoder();
  const computedLength = sorted.reduce(
    (acc, chunk) => acc + encoder.encode(chunk.content).length,
    0,
  );

  const missing: number[] = [];
  const totalChunks = Number(metadata?.totalChunks ?? 0);
  for (let i = 0; i < totalChunks; i += 1) {
    if (!sorted.find((chunk) => chunk.chunkIndex === i)) missing.push(i);
  }

  let hashMatch: boolean | null = null;
  let computedHash: string | undefined;
  if (
    missing.length === 0 &&
    totalChunks > 0 &&
    metadata?.fullStoryHash &&
    metadata.fullStoryHash !== ethers.ZeroHash
  ) {
    computedHash = computeStoryHash(sorted);
    hashMatch = computedHash === metadata.fullStoryHash;
  }

  return {
    chunks: sorted,
    fullStory,
    integrity: {
      missing,
      lengthMatch: metadata ? computedLength === metadata.totalLength : true,
      hashMatch,
      computedLength,
      computedHash,
    },
  };
}

export function mergeStoryChunkRecords(
  existingChunks: StoryChunk[],
  incomingChunks: StoryChunk[],
  totalChunks?: number,
): StoryChunk[] {
  const byIndex = new Map<number, StoryChunk>();
  for (const chunk of existingChunks) {
    const idx = Number(chunk?.chunkIndex);
    if (Number.isFinite(idx) && idx >= 0 && !byIndex.has(idx)) {
      byIndex.set(idx, chunk);
    }
  }
  for (const chunk of incomingChunks) {
    const idx = Number(chunk?.chunkIndex);
    if (Number.isFinite(idx) && idx >= 0) {
      byIndex.set(idx, chunk);
    }
  }
  const maxChunks = Number(totalChunks ?? 0);
  return Array.from(byIndex.values()).filter((chunk) =>
    maxChunks > 0 ? Number(chunk.chunkIndex) < maxChunks : true,
  );
}

export function getMissingStoryOffset(chunks: StoryChunk[]): number {
  const seen = new Set(
    chunks
      .map((chunk) => Number(chunk?.chunkIndex))
      .filter((idx) => Number.isFinite(idx) && idx >= 0),
  );
  let offset = 0;
  while (seen.has(offset)) offset += 1;
  return offset;
}

export function buildStoryDataResult(
  chunks: StoryChunk[],
  metadata: StoryMetadata,
  fetchedAt: number,
): StoryDataResult {
  const snapshot = buildStorySnapshot(chunks, metadata);
  return {
    chunks: snapshot.chunks,
    fullStory: snapshot.fullStory,
    integrity: snapshot.integrity,
    metadata,
    loading: false,
    fetchedAt,
  };
}

export function applyStoryDataToNode(
  nodesData: Record<string, NodeData>,
  nodeId: string,
  storyData: StoryDataResult,
): Record<string, NodeData> {
  const current = nodesData[nodeId];
  if (!current) return nodesData;
  return {
    ...nodesData,
    [nodeId]: {
      ...current,
      storyMetadata: storyData.metadata,
      storyChunks: storyData.chunks,
      storyFetchedAt: storyData.fetchedAt,
    },
  };
}
