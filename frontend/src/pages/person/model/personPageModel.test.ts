import { describe, expect, it } from "vitest";
import { STORY_BIOGRAPHY_SCHEMA_ID } from "@deepfamily/protocol-core";
import {
  makeNodeId,
  type NodeData,
  type StoryRecord,
  type StoryMetadata,
} from "../../../shared/model";
import {
  buildPrefetchedStoryDetailData,
  getRecordParagraphs,
  getFreshCachedStoryDetail,
  getFullStoryParagraphs,
  groupStoryRecords,
  hasStoryIntegrityIssues,
  isValidPersonTokenId,
  mapPersonStoryFetchError,
  normalizeRecordType,
} from "./personPageModel";

const zeroHash = `0x${"0".repeat(64)}`;

function makeRecord(overrides: Partial<StoryRecord>): StoryRecord {
  return {
    title: "",
    recordIndex: 0,
    payloadHash: zeroHash,
    content: "hello",
    timestamp: 1,
    author: "0x0000000000000000000000000000000000000000",
    recordType: 0,
    attachmentCID: "",
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<StoryMetadata> = {}): StoryMetadata {
  return {
    totalRecords: 2,
    recordsHead: zeroHash,
    lastUpdateTime: 1,
    isSealed: false,
    totalPayloadLength: 10,
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
  it("validates token ids and normalizes record types", () => {
    expect(isValidPersonTokenId("42")).toBe(true);
    expect(isValidPersonTokenId("abc")).toBe(false);
    expect(normalizeRecordType("3")).toBe(3);
    expect(normalizeRecordType("abc")).toBe(0);
    expect(normalizeRecordType(undefined)).toBe(0);
  });

  it("hydrates prefetched story data without mutating record semantics", () => {
    const data = buildPrefetchedStoryDetailData("42", {
      tokenId: "42",
      fullName: "Ada",
      storyRecords: [
        makeRecord({ title: "", recordIndex: 0, content: "hello ", recordType: "2" as any }),
        makeRecord({
          title: "",
          recordIndex: 1,
          content: "world",
          attachmentCID: undefined as any,
        }),
      ],
    });

    expect(data?.fullStory).toBe("hello world");
    expect(data?.storyRecords?.map((record) => record.recordType)).toEqual([2, 0]);
    expect(data?.storyRecords?.map((record) => record.attachmentCID)).toEqual(["", ""]);
    expect(buildPrefetchedStoryDetailData("7", { tokenId: "42" })).toBeNull();
  });

  it("groups records by type and builds paragraph views in display order", () => {
    const records = [
      makeRecord({ title: "", recordIndex: 2, content: "C", recordType: 3 }),
      makeRecord({ title: "", recordIndex: 0, content: "A", recordType: 1 }),
      makeRecord({ title: "", recordIndex: 1, content: "B", recordType: 1 }),
    ];

    expect(getRecordParagraphs(records)).toEqual(["A", "B", "C"]);
    expect(groupStoryRecords(records).map((group) => [group.type, group.records.length])).toEqual([
      [1, 2],
      [3, 1],
    ]);
    expect(getFullStoryParagraphs("One. Two. Three.", "paragraph")).toEqual(["One. Two. Three."]);
    expect(getFullStoryParagraphs("One.\n\nTwo.", "paragraph")).toEqual(["One.", "Two."]);
    expect(getFullStoryParagraphs("raw", "raw")).toEqual([]);
  });

  it("keeps archived biography in the basic story while excluding it from ordinary views", () => {
    const biography = makeRecord({
      schemaId: STORY_BIOGRAPHY_SCHEMA_ID,
      content: "Original public biography",
    });
    const ordinary = makeRecord({
      title: "",
      recordIndex: 1,
      recordType: 1,
      content: "A later story",
    });
    const data = buildPrefetchedStoryDetailData("42", {
      storyRecords: [biography, ordinary],
      fullStory: "Original public biographyA later story",
    });

    expect(data?.nftCoreInfo?.story).toBe(biography.content);
    expect(data?.fullStory).toBe(ordinary.content);
    expect(data?.storyRecords).toEqual([biography, ordinary]);
    expect(getRecordParagraphs(data?.storyRecords)).toEqual([ordinary.content]);
    const groups = groupStoryRecords(data?.storyRecords);
    expect(groups.map((group) => group.type)).toEqual([1]);
    expect(groups[0].records[0]).toMatchObject({ recordIndex: 1, displayIndex: 1 });
  });

  it("uses fresh cached story data only inside the expected ttl", () => {
    const records = [
      makeRecord({ title: "", recordIndex: 0, content: "hello " }),
      makeRecord({ title: "", recordIndex: 1, content: "world" }),
    ];
    const node = makeNode({
      storyMetadata: makeMetadata({ totalPayloadLength: 11 }),
      storyRecords: records,
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
        storyMetadata: makeMetadata({ totalRecords: 1 }),
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
