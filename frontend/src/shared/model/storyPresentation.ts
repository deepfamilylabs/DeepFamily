import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import type { StoryChunk, StoryMetadata } from "./graph";

export function isBiographyStoryRecord(record: StoryChunk): boolean {
  // Unsupported ordinary formats also use chunkType 0 as a decoding fallback.
  // Only the reserved initialization schema identifies the public biography.
  return record.chunkIndex === 0 && record.schemaId === STORY_BIOGRAPHY_SCHEMA_ID;
}

/** Derive the visible story without changing Archive indices or commitments. */
export function getStoryPresentation(records: StoryChunk[] = [], metadata?: StoryMetadata | null) {
  const biography = records.find(isBiographyStoryRecord);
  const biographyPayloadLength =
    biography?.payloadLength ??
    metadata?.biographyPayloadLength ??
    (biography ? new TextEncoder().encode(biography.content).length : undefined);
  const biographyCount = biography || biographyPayloadLength !== undefined ? 1 : 0;
  const chunks = records
    .filter((record) => !isBiographyStoryRecord(record))
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((record) => ({ ...record, displayIndex: record.chunkIndex + 1 - biographyCount }));
  return {
    biography,
    chunks,
    fullStory: chunks.map((record) => record.content).join(""),
    totalChunks: metadata ? Math.max(0, metadata.totalChunks - biographyCount) : chunks.length,
    totalLength: metadata
      ? Math.max(0, metadata.totalLength - (biographyPayloadLength ?? 0))
      : chunks.reduce(
          (total, record) =>
            total + (record.payloadLength ?? new TextEncoder().encode(record.content).length),
          0,
        ),
  };
}
