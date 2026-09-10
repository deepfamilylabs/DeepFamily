import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID, STORY_CHUNK_SCHEMA_ID } from "@deepfamily/protocol-core";
import { getStoryPresentation } from "./storyPresentation";
import { hasDetailedStory, type StoryChunk, type StoryMetadata } from "./graph";
import { buildStorySnapshot, buildStoryDataResult, applyStoryDataToNode } from "./storyData";
import { computeStoryHash } from "./story";

const record = (index: number, biography = false): StoryChunk => ({
  chunkIndex: index,
  chunkType: biography ? 0 : 1,
  content: biography ? "  公开传记\r\n" : `正文${index}`,
  schemaId: biography ? STORY_BIOGRAPHY_SCHEMA_ID : STORY_CHUNK_SCHEMA_ID,
  chunkHash: ethers.id(`payload${index}`),
  recordHash: ethers.id(`record${index}`),
  payloadLength: biography ? 100 : 30,
  timestamp: 1,
  editor: ethers.ZeroAddress,
  attachmentCID: "",
});
const metadata = (records: StoryChunk[]): StoryMetadata => ({
  totalChunks: records.length,
  totalLength: records.reduce((sum, r) => sum + r.payloadLength!, 0),
  fullStoryHash: computeStoryHash(records),
  lastUpdateTime: 1,
  isSealed: false,
});

describe("public biography and ordinary story presentation", () => {
  it("renders biography as the basic story with no detailed chunks, retaining full Archive integrity", () => {
    const biography = record(0, true);
    const records = [biography];
    const meta = metadata(records);
    const view = getStoryPresentation(records, meta);
    expect(view).toMatchObject({
      biography,
      chunks: [],
      totalChunks: 0,
      totalLength: 0,
      fullStory: "",
    });
    expect(hasDetailedStory({ storyChunks: records, storyMetadata: meta })).toBe(false);
    expect(hasDetailedStory({ storyMetadata: { ...meta, biographyPayloadLength: 100 } })).toBe(
      false,
    );
    const snapshot = buildStorySnapshot(records, meta);
    expect(snapshot.chunks).toEqual(records);
    expect(snapshot.fullStory).toBe("");
    expect(snapshot.integrity).toMatchObject({ missing: [], lengthMatch: true, hashMatch: true });
    const node = { id: "n", personHash: "0xp", versionIndex: 1 };
    const updated = applyStoryDataToNode({ n: node }, "n", buildStoryDataResult(records, meta, 1));
    expect(updated.n.nftPublicStory).toBe(biography.content);
  });

  it("numbers only ordinary chunks while the Archive head still commits to biography and chunks", () => {
    const records = [record(0, true), record(1), record(2)];
    const meta = metadata(records);
    const view = getStoryPresentation(records, meta);
    expect(view.totalChunks).toBe(2);
    expect(view.totalLength).toBe(60);
    expect(view.chunks.map((r) => [r.chunkIndex, r.displayIndex])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(view.fullStory).toBe("正文1正文2");
    expect(buildStorySnapshot(records, meta).integrity.hashMatch).toBe(true);
    expect(buildStorySnapshot(records.slice(1), meta).integrity.missing).toEqual([0]);
    expect(records[1].displayIndex).toBeUndefined();
    expect(meta.totalChunks).toBe(3);
  });

  it("starts at display number 1 without a biography and keeps unsupported ordinary formats visible", () => {
    const unknown = {
      ...record(1),
      schemaId: ethers.id("future"),
      chunkType: 0,
      unsupportedSchema: true,
    };
    const view = getStoryPresentation([record(0), unknown]);
    expect(view.chunks.map((r) => [r.chunkIndex, r.displayIndex])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(view.chunks[1].unsupportedSchema).toBe(true);
    expect(hasDetailedStory({ storyChunks: [unknown] })).toBe(true);
  });

  it("uses the initial reference for counts and page numbering before the biography payload is loaded", () => {
    const records = [record(0, true), record(1), record(2)];
    const meta = { ...metadata(records), biographyPayloadLength: 100 };
    const view = getStoryPresentation([records[2]], meta);
    expect(view).toMatchObject({ totalChunks: 2, totalLength: 60 });
    expect(view.chunks[0]).toMatchObject({ chunkIndex: 2, displayIndex: 2 });
    const unsupportedBiography = { ...records[0], unsupportedSchema: true, content: "" };
    expect(getStoryPresentation([unsupportedBiography], meta).biography).toBe(unsupportedBiography);
    expect(getStoryPresentation([unsupportedBiography], meta).chunks).toEqual([]);
  });
});
