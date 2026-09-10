import {
  decodeStoryRecord,
  encodeStoryRecord,
  type StoryRecordInput,
} from "@deepfamily/protocol-core";

// Application policy, never a form value. All current public writes use gzip-v1.
export const PUBLIC_STORY_COMPRESSION_SUITE = 1;
export function encodePublicStoryRecord(input: StoryRecordInput): Uint8Array {
  const payload = encodeStoryRecord(input, { compressionSuite: PUBLIC_STORY_COMPRESSION_SUITE });
  const restored = decodeStoryRecord(payload);
  if (
    restored.content !== input.content ||
    restored.chunkType !== input.chunkType ||
    restored.attachmentCID !== input.attachmentCID
  )
    throw new Error("Public story compression failed exact-content verification");
  return payload;
}
