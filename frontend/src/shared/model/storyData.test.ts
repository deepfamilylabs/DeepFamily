import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import {
  applyStoryDataToNode,
  buildStoryDataResult,
  buildStorySnapshot,
  getMissingStoryOffset,
  mergeStoryChunkRecords,
  parseStoryChunkRecord,
} from "./storyData";
import { computeStoryHash } from "./story";

describe("storyData parseStoryChunkRecord", () => {
  it("normalizes tuple-like chunk records", () => {
    const parsed = parseStoryChunkRecord([
      2,
      "0xhash",
      "hello",
      123,
      "0x00000000000000000000000000000000000000aa",
      1,
      "cid",
    ]);

    expect(parsed).toEqual({
      chunkIndex: 2,
      chunkHash: "0xhash",
      content: "hello",
      timestamp: 123,
      editor: "0x00000000000000000000000000000000000000aa",
      chunkType: 1,
      attachmentCID: "cid",
    });
  });
});

describe("storyData buildStorySnapshot", () => {
  it("computes full story and integrity for complete chunk sets", () => {
    const chunks = [
      {
        chunkIndex: 1,
        chunkHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
        content: "world",
        timestamp: 2,
        editor: ethers.ZeroAddress,
        chunkType: 0,
        attachmentCID: "",
      },
      {
        chunkIndex: 0,
        chunkHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        content: "hello ",
        timestamp: 1,
        editor: ethers.ZeroAddress,
        chunkType: 0,
        attachmentCID: "",
      },
    ];
    const snapshot = buildStorySnapshot(
      chunks,
      {
        totalChunks: 2,
        totalLength: 11,
        isSealed: true,
        lastUpdateTime: 0,
        fullStoryHash: computeStoryHash(chunks),
      },
    );

    expect(snapshot.fullStory).toBe("hello world");
    expect(snapshot.integrity.missing).toEqual([]);
    expect(snapshot.integrity.lengthMatch).toBe(true);
    expect(snapshot.integrity.hashMatch).toBe(true);
  });

  it("reports missing indices when chunk data is incomplete", () => {
    const snapshot = buildStorySnapshot(
      [
        {
          chunkIndex: 1,
          chunkHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
          content: "world",
          timestamp: 2,
          editor: ethers.ZeroAddress,
          chunkType: 0,
          attachmentCID: "",
        },
      ],
      {
        totalChunks: 3,
        totalLength: 5,
        isSealed: false,
        lastUpdateTime: 0,
        fullStoryHash: ethers.ZeroHash,
      },
    );

    expect(snapshot.chunks).toHaveLength(1);
    expect(snapshot.integrity.missing).toEqual([0, 2]);
    expect(snapshot.integrity.hashMatch).toBeNull();
  });

  it("merges chunks and computes the first missing offset", () => {
    const merged = mergeStoryChunkRecords(
      [
        {
          chunkIndex: 0,
          chunkHash: "0x1",
          content: "A",
          timestamp: 1,
          editor: ethers.ZeroAddress,
          chunkType: 0,
          attachmentCID: "",
        },
      ],
      [
        {
          chunkIndex: 2,
          chunkHash: "0x3",
          content: "C",
          timestamp: 3,
          editor: ethers.ZeroAddress,
          chunkType: 0,
          attachmentCID: "",
        },
        {
          chunkIndex: 1,
          chunkHash: "0x2",
          content: "B",
          timestamp: 2,
          editor: ethers.ZeroAddress,
          chunkType: 0,
          attachmentCID: "",
        },
      ],
      3,
    );

    expect(merged.map((chunk) => chunk.chunkIndex).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(getMissingStoryOffset(merged)).toBe(3);
  });

  it("builds a story data result and applies it to a node", () => {
    const storyData = buildStoryDataResult(
      [
        {
          chunkIndex: 0,
          chunkHash: "0x1",
          content: "Hello",
          timestamp: 1,
          editor: ethers.ZeroAddress,
          chunkType: 0,
          attachmentCID: "",
        },
      ],
      {
        totalChunks: 1,
        totalLength: 5,
        isSealed: false,
        lastUpdateTime: 1,
        fullStoryHash: "",
      },
      123,
    );

    const next = applyStoryDataToNode(
      {
        "0xabc-v-1": {
          personHash: "0xabc",
          versionIndex: 1,
          id: "0xabc-v-1",
        },
      },
      "0xabc-v-1",
      storyData,
    );

    expect(next["0xabc-v-1"]?.storyMetadata?.totalChunks).toBe(1);
    expect(next["0xabc-v-1"]?.story).toBe("Hello");
    expect(next["0xabc-v-1"]?.storyFetchedAt).toBe(123);
    expect(next["0xabc-v-1"]?.storyChunks?.[0]?.content).toBe("Hello");
  });

  it("does not replace the node story with incomplete chunks", () => {
    const storyData = buildStoryDataResult(
      [
        {
          chunkIndex: 1,
          chunkHash: "0x1",
          content: "tail",
          timestamp: 1,
          editor: ethers.ZeroAddress,
          chunkType: 0,
          attachmentCID: "",
        },
      ],
      {
        totalChunks: 2,
        totalLength: 8,
        isSealed: false,
        lastUpdateTime: 1,
        fullStoryHash: "",
      },
      123,
    );

    const next = applyStoryDataToNode(
      {
        "0xabc-v-1": {
          personHash: "0xabc",
          versionIndex: 1,
          id: "0xabc-v-1",
          story: "preview",
        },
      },
      "0xabc-v-1",
      storyData,
    );

    expect(next["0xabc-v-1"]?.story).toBe("preview");
    expect(next["0xabc-v-1"]?.storyChunks?.[0]?.content).toBe("tail");
  });
});
