import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData, type StoryChunk, type StoryMetadata } from "../../../shared/model";
import {
  buildPrefetchedStoryDetailData,
  getChunkParagraphs,
  getFreshCachedStoryDetail,
  getFullStoryParagraphs,
  groupStoryChunks,
  hasStoryIntegrityIssues,
  isValidPersonTokenId,
  mapPersonStoryFetchError,
  normalizeChunkType,
} from "./personPageModel";

const zeroHash = `0x${"0".repeat(64)}`;

function makeChunk(overrides: Partial<StoryChunk>): StoryChunk {
  return {
    chunkIndex: 0,
    chunkHash: zeroHash,
    content: "hello",
    timestamp: 1,
    editor: "0x0000000000000000000000000000000000000000",
    chunkType: 0,
    attachmentCID: "",
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<StoryMetadata> = {}): StoryMetadata {
  return {
    totalChunks: 2,
    fullStoryHash: zeroHash,
    lastUpdateTime: 1,
    isSealed: false,
    totalLength: 10,
    ...overrides,
  };
}

function makeNode(overrides: Partial<NodeData>): NodeData {
  const personHash = overrides.personHash ?? "0xperson";
  const versionIndex = overrides.versionIndex ?? 1;
  return {
    personHash,
    versionIndex,
    id: makeNodeId(personHash, versionIndex),
    tokenId: "42",
    fullName: "Ada Lovelace",
    ...overrides,
  };
}

describe("personPageModel", () => {
  it("validates token ids and normalizes chunk types", () => {
    expect(isValidPersonTokenId("42")).toBe(true);
    expect(isValidPersonTokenId("abc")).toBe(false);
    expect(normalizeChunkType("3")).toBe(3);
    expect(normalizeChunkType("abc")).toBe(0);
    expect(normalizeChunkType(undefined)).toBe(0);
  });

  it("hydrates prefetched story data without mutating chunk semantics", () => {
    const data = buildPrefetchedStoryDetailData("42", {
      tokenId: "42",
      fullName: "Ada",
      storyChunks: [
        makeChunk({ chunkIndex: 0, content: "hello ", chunkType: "2" as any }),
        makeChunk({ chunkIndex: 1, content: "world", attachmentCID: undefined as any }),
      ],
    });

    expect(data?.fullStory).toBe("hello world");
    expect(data?.storyChunks?.map((chunk) => chunk.chunkType)).toEqual([2, 0]);
    expect(data?.storyChunks?.map((chunk) => chunk.attachmentCID)).toEqual(["", ""]);
    expect(buildPrefetchedStoryDetailData("7", { tokenId: "42" })).toBeNull();
  });

  it("groups chunks by type and builds paragraph views in display order", () => {
    const chunks = [
      makeChunk({ chunkIndex: 2, content: "C", chunkType: 3 }),
      makeChunk({ chunkIndex: 0, content: "A", chunkType: 1 }),
      makeChunk({ chunkIndex: 1, content: "B", chunkType: 1 }),
    ];

    expect(getChunkParagraphs(chunks)).toEqual(["A", "B", "C"]);
    expect(groupStoryChunks(chunks).map((group) => [group.type, group.chunks.length])).toEqual([
      [1, 2],
      [3, 1],
    ]);
    expect(getFullStoryParagraphs("One. Two. Three.", "paragraph")).toEqual(["One. Two. Three."]);
    expect(getFullStoryParagraphs("One.\n\nTwo.", "paragraph")).toEqual(["One.", "Two."]);
    expect(getFullStoryParagraphs("raw", "raw")).toEqual([]);
  });

  it("uses fresh cached story data only inside the expected ttl", () => {
    const chunks = [
      makeChunk({ chunkIndex: 0, content: "hello " }),
      makeChunk({ chunkIndex: 1, content: "world" }),
    ];
    const node = makeNode({
      storyMetadata: makeMetadata({ totalLength: 11 }),
      storyChunks: chunks,
      storyFetchedAt: 1000,
    });

    expect(getFreshCachedStoryDetail(node, 1000 + 30_000)?.fullStory).toBe("hello world");
    expect(getFreshCachedStoryDetail(node, 1000 + 3 * 60 * 1000)).toBeNull();
    expect(
      getFreshCachedStoryDetail(
        { ...node, storyMetadata: makeMetadata({ isSealed: true }), storyFetchedAt: 1000 },
        1000 + 3 * 60 * 1000,
      )?.fullStory,
    ).toBe("hello world");
  });

  it("detects integrity issues and maps common fetch errors", () => {
    const t = (_key: string, fallback?: string) => fallback ?? "";

    expect(
      hasStoryIntegrityIssues({
        tokenId: "42",
        storyMetadata: makeMetadata({ totalChunks: 1 }),
        integrity: { missing: [0], lengthMatch: true, hashMatch: null, computedLength: 0 },
      }),
    ).toBe(true);
    expect(mapPersonStoryFetchError(new Error("query for nonexistent token"), t)).toBe(
      "Token does not exist",
    );
    expect(mapPersonStoryFetchError(new Error("execution reverted"), t)).toBe(
      "Failed to load token",
    );
  });
});
