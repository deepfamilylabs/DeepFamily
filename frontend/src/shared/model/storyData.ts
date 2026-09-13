import { ethers } from "ethers";
import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import { computeStoryRecordsHead } from "./story";
import { getStoryPresentation } from "./storyPresentation";
import type { NodeData, StoryRecord, StoryMetadata } from "./graph";

export interface StoryIntegrity {
  missing: number[];
  lengthMatch: boolean;
  hashMatch: boolean | null;
  computedLength: number;
  computedHash?: string;
}

export interface StorySnapshot {
  records: StoryRecord[];
  fullStory: string;
  integrity: StoryIntegrity;
}

export interface StoryDataResult {
  records: StoryRecord[];
  fullStory: string;
  integrity: StoryIntegrity;
  metadata: StoryMetadata;
  loading: false;
  fetchedAt: number;
}

export function buildStorySnapshot(
  records: StoryRecord[],
  metadata?: StoryMetadata | null,
): StorySnapshot {
  const sorted = [...records]
    .filter((record) => Number.isFinite(Number(record?.recordIndex)))
    .sort((a, b) => a.recordIndex - b.recordIndex);
  const fullStory = getStoryPresentation(sorted, metadata).fullStory;
  const encoder = new TextEncoder();
  const computedLength = sorted.reduce(
    (acc, record) => acc + (record.payloadLength ?? encoder.encode(record.content).length),
    0,
  );

  const missing: number[] = [];
  const totalRecords = Number(metadata?.totalRecords ?? 0);
  for (let i = 0; i < totalRecords; i += 1) {
    if (!sorted.find((record) => record.recordIndex === i)) missing.push(i);
  }

  let hashMatch: boolean | null = null;
  let computedHash: string | undefined;
  if (
    missing.length === 0 &&
    totalRecords > 0 &&
    sorted.every((record) => Boolean(record.recordHash)) &&
    metadata?.recordsHead &&
    metadata.recordsHead !== ethers.ZeroHash
  ) {
    computedHash = computeStoryRecordsHead(sorted);
    hashMatch = computedHash === metadata.recordsHead;
  }

  return {
    records: sorted,
    fullStory,
    integrity: {
      missing,
      lengthMatch: metadata ? computedLength === metadata.totalPayloadLength : true,
      hashMatch,
      computedLength,
      computedHash,
    },
  };
}

export function mergeStoryRecords(
  existingRecords: StoryRecord[],
  incomingRecords: StoryRecord[],
  totalRecords?: number,
): StoryRecord[] {
  const byIndex = new Map<number, StoryRecord>();
  for (const record of existingRecords) {
    const idx = Number(record?.recordIndex);
    if (Number.isFinite(idx) && idx >= 0 && !byIndex.has(idx)) {
      byIndex.set(idx, record);
    }
  }
  for (const record of incomingRecords) {
    const idx = Number(record?.recordIndex);
    if (Number.isFinite(idx) && idx >= 0) {
      byIndex.set(idx, record);
    }
  }
  const maxRecords = Number(totalRecords ?? 0);
  return Array.from(byIndex.values()).filter((record) =>
    maxRecords > 0 ? Number(record.recordIndex) < maxRecords : true,
  );
}

export function getMissingStoryOffset(records: StoryRecord[]): number {
  const seen = new Set(
    records
      .map((record) => Number(record?.recordIndex))
      .filter((idx) => Number.isFinite(idx) && idx >= 0),
  );
  let offset = 0;
  while (seen.has(offset)) offset += 1;
  return offset;
}

export function buildStoryDataResult(
  records: StoryRecord[],
  metadata: StoryMetadata,
  fetchedAt: number,
): StoryDataResult {
  const snapshot = buildStorySnapshot(records, metadata);
  return {
    records: snapshot.records,
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
  const biography = storyData.records.find(
    (record) =>
      record.recordIndex === 0 &&
      record.schemaId === STORY_BIOGRAPHY_SCHEMA_ID &&
      !record.unsupportedSchema,
  );
  return {
    ...nodesData,
    [nodeId]: {
      ...current,
      nftPublicStory: biography?.content ?? current.nftPublicStory,
      nftPublicStoryTitle: biography?.title ?? current.nftPublicStoryTitle,
      storyMetadata: storyData.metadata,
      storyRecords: storyData.records,
      storyFetchedAt: storyData.fetchedAt,
    },
  };
}
