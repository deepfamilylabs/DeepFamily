import { describe, expect, it } from "vitest";
import type { StoryChunk } from "../../../shared/model";
import {
  convertChunkTypeToNumber,
  getByteLength,
  getValidTokenId,
  isChunkFormDirty,
  normalizeStoryChunks,
  resolveAttachmentUrl,
  sortStoryChunks,
} from "./storyEditorModel";

describe("storyEditorModel", () => {
  it("normalizes chunk type values and attachment defaults", () => {
    const chunks = normalizeStoryChunks([
      { chunkIndex: 0, chunkType: "3" as any, attachmentCID: undefined } as unknown as StoryChunk,
      { chunkIndex: 1, chunkType: "abc" as any, attachmentCID: "ipfs://cid" } as StoryChunk,
    ]);

    expect(chunks?.map((chunk) => chunk.chunkType)).toEqual([3, 0]);
    expect(chunks?.map((chunk) => chunk.attachmentCID)).toEqual(["", "ipfs://cid"]);
    expect(convertChunkTypeToNumber("")).toBe(0);
  });

  it("sorts chunks and validates route token ids", () => {
    const chunks = [
      { chunkIndex: 2 } as StoryChunk,
      { chunkIndex: 0 } as StoryChunk,
      { chunkIndex: 1 } as StoryChunk,
    ];

    expect(sortStoryChunks(chunks).map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(getValidTokenId("42")).toBe("42");
    expect(getValidTokenId("abc")).toBeUndefined();
  });

  it("tracks dirty form state by meaningful story input fields", () => {
    expect(isChunkFormDirty({ content: " ", chunkType: 0, attachmentCID: "" })).toBe(false);
    expect(isChunkFormDirty({ content: "story", chunkType: 0, attachmentCID: "" })).toBe(true);
    expect(isChunkFormDirty({ content: "", chunkType: 1, attachmentCID: "" })).toBe(true);
    expect(isChunkFormDirty({ content: "", chunkType: 0, attachmentCID: "cid" })).toBe(true);
  });

  it("counts bytes and resolves ipfs attachment URLs", () => {
    expect(getByteLength("abc")).toBe(3);
    expect(getByteLength("中")).toBe(3);
    expect(resolveAttachmentUrl("ipfs://bafy")).toBe("https://ipfs.io/ipfs/bafy");
    expect(resolveAttachmentUrl("https://example.test/file")).toBe("https://example.test/file");
  });
});
