import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import type { StoryRecord, StoryMetadata } from "./graph";

export function isBiographyStoryRecord(record: StoryRecord): boolean {
  // Unsupported ordinary formats also use recordType 0 as a decoding fallback.
  // Only the reserved initialization schema identifies the public biography.
  return record.recordIndex === 0 && record.schemaId === STORY_BIOGRAPHY_SCHEMA_ID;
}

/** Derive the visible story without changing Archive indices or commitments. */
export function getStoryPresentation(
  archiveRecords: StoryRecord[] = [],
  metadata?: StoryMetadata | null,
) {
  const biography = archiveRecords.find(isBiographyStoryRecord);
  const biographyPayloadLength =
    biography?.payloadLength ??
    metadata?.biographyPayloadLength ??
    (biography ? new TextEncoder().encode(biography.content).length : undefined);
  const biographyCount = biography || biographyPayloadLength !== undefined ? 1 : 0;
  const records = archiveRecords
    .filter((record) => !isBiographyStoryRecord(record))
    .sort((a, b) => a.recordIndex - b.recordIndex)
    .map((record) => ({ ...record, displayIndex: record.recordIndex + 1 - biographyCount }));
  return {
    biography,
    records,
    fullStory: records.map((record) => record.content).join(""),
    totalRecords: metadata ? Math.max(0, metadata.totalRecords - biographyCount) : records.length,
    totalPayloadLength: metadata
      ? Math.max(0, metadata.totalPayloadLength - (biographyPayloadLength ?? 0))
      : records.reduce(
          (total, record) =>
            total + (record.payloadLength ?? new TextEncoder().encode(record.content).length),
          0,
        ),
  };
}
