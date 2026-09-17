import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import {
  applyStoryDataToNode,
  buildStoryDataResult,
  buildStorySnapshot,
  getMissingStoryOffset,
  mergeStoryRecords,
} from "./storyData";
import { computeStoryRecordsHead } from "./story";

describe("storyData buildStorySnapshot", () => {
  it("computes full story and integrity for complete record sets", () => {
    const records = [
      {
        title: "",
        recordIndex: 1,
        recordHash: ethers.id("verified record"),
        payloadHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
        content: "world",
        timestamp: 2,
        author: ethers.ZeroAddress,
        recordType: 0,
        attachmentURI: "",
      },
      {
        title: "",
        recordIndex: 0,
        recordHash: ethers.id("verified record"),
        payloadHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        content: "hello ",
        timestamp: 1,
        author: ethers.ZeroAddress,
        recordType: 0,
        attachmentURI: "",
      },
    ];
    const snapshot = buildStorySnapshot(records, {
      totalRecords: 2,
      totalPayloadLength: 11,
      isSealed: true,
      lastUpdateTime: 0,
      recordsHead: computeStoryRecordsHead(records),
    });

    expect(snapshot.fullStory).toBe("hello world");
    expect(snapshot.integrity.missing).toEqual([]);
    expect(snapshot.integrity.lengthMatch).toBe(true);
    expect(snapshot.integrity.hashMatch).toBe(true);
  });

  it("reports missing indices when record data is incomplete", () => {
    const snapshot = buildStorySnapshot(
      [
        {
          title: "",
          recordIndex: 1,
          recordHash: ethers.id("verified record"),
          payloadHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
          content: "world",
          timestamp: 2,
          author: ethers.ZeroAddress,
          recordType: 0,
          attachmentURI: "",
        },
      ],
      {
        totalRecords: 3,
        totalPayloadLength: 5,
        isSealed: false,
        lastUpdateTime: 0,
        recordsHead: ethers.ZeroHash,
      },
    );

    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.integrity.missing).toEqual([0, 2]);
    expect(snapshot.integrity.hashMatch).toBeNull();
  });

  it("merges records and computes the first missing offset", () => {
    const merged = mergeStoryRecords(
      [
        {
          title: "",
          recordIndex: 0,
          recordHash: ethers.id("verified record"),
          payloadHash: "0x1",
          content: "A",
          timestamp: 1,
          author: ethers.ZeroAddress,
          recordType: 0,
          attachmentURI: "",
        },
      ],
      [
        {
          title: "",
          recordIndex: 2,
          recordHash: ethers.id("verified record"),
          payloadHash: "0x3",
          content: "C",
          timestamp: 3,
          author: ethers.ZeroAddress,
          recordType: 0,
          attachmentURI: "",
        },
        {
          title: "",
          recordIndex: 1,
          recordHash: ethers.id("verified record"),
          payloadHash: "0x2",
          content: "B",
          timestamp: 2,
          author: ethers.ZeroAddress,
          recordType: 0,
          attachmentURI: "",
        },
      ],
      3,
    );

    expect(merged.map((record) => record.recordIndex).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(getMissingStoryOffset(merged)).toBe(3);
  });

  it("builds a story data result and applies it to a node", () => {
    const storyData = buildStoryDataResult(
      [
        {
          title: "",
          recordIndex: 0,
          recordHash: ethers.id("verified record"),
          payloadHash: "0x1",
          content: "Hello",
          timestamp: 1,
          author: ethers.ZeroAddress,
          recordType: 0,
          attachmentURI: "",
        },
      ],
      {
        totalRecords: 1,
        totalPayloadLength: 5,
        isSealed: false,
        lastUpdateTime: 1,
        recordsHead: "",
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

    expect(next["0xabc-v-1"]?.storyMetadata?.totalRecords).toBe(1);
    expect(next["0xabc-v-1"]?.nftPublicStory).toBeUndefined();
    expect(next["0xabc-v-1"]?.storyFetchedAt).toBe(123);
    expect(next["0xabc-v-1"]?.storyRecords?.[0]?.content).toBe("Hello");
  });

  it("does not replace the node story with incomplete records", () => {
    const storyData = buildStoryDataResult(
      [
        {
          title: "",
          recordIndex: 1,
          recordHash: ethers.id("verified record"),
          payloadHash: "0x1",
          content: "tail",
          timestamp: 1,
          author: ethers.ZeroAddress,
          recordType: 0,
          attachmentURI: "",
        },
      ],
      {
        totalRecords: 2,
        totalPayloadLength: 8,
        isSealed: false,
        lastUpdateTime: 1,
        recordsHead: "",
      },
      123,
    );

    const next = applyStoryDataToNode(
      {
        "0xabc-v-1": {
          personHash: "0xabc",
          versionIndex: 1,
          id: "0xabc-v-1",
          nftPublicStory: "preview",
        },
      },
      "0xabc-v-1",
      storyData,
    );

    expect(next["0xabc-v-1"]?.nftPublicStory).toBe("preview");
    expect(next["0xabc-v-1"]?.storyRecords?.[0]?.content).toBe("tail");
  });
});
