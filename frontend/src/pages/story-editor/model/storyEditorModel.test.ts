import { describe, expect, it } from "vitest";
import type { StoryRecord } from "../../../shared/model";
import {
  convertRecordTypeToNumber,
  getByteLength,
  getValidTokenId,
  isRecordFormDirty,
  normalizeStoryRecords,
  resolveAttachmentUrl,
  sortStoryRecords,
} from "./storyEditorModel";

describe("storyEditorModel", () => {
  it("normalizes record type values and attachment defaults", () => {
    const records = normalizeStoryRecords([
      { recordIndex: 0, recordType: "3" as any, attachmentCID: undefined } as unknown as StoryRecord,
      { recordIndex: 1, recordType: "abc" as any, attachmentCID: "ipfs://cid" } as StoryRecord,
    ]);

    expect(records?.map((record) => record.recordType)).toEqual([3, 0]);
    expect(records?.map((record) => record.attachmentCID)).toEqual(["", "ipfs://cid"]);
    expect(convertRecordTypeToNumber("")).toBe(0);
  });

  it("sorts records and validates route token ids", () => {
    const records = [
      { recordIndex: 2 } as StoryRecord,
      { recordIndex: 0 } as StoryRecord,
      { recordIndex: 1 } as StoryRecord,
    ];

    expect(sortStoryRecords(records).map((record) => record.recordIndex)).toEqual([0, 1, 2]);
    expect(getValidTokenId("42")).toBe("42");
    expect(getValidTokenId("abc")).toBeUndefined();
  });

  it("tracks dirty form state by meaningful story input fields", () => {
    expect(isRecordFormDirty({ content: " ", recordType: 1, attachmentCID: "" })).toBe(false);
    expect(isRecordFormDirty({ content: "story", recordType: 1, attachmentCID: "" })).toBe(true);
    expect(isRecordFormDirty({ content: "", recordType: 2, attachmentCID: "" })).toBe(true);
    expect(isRecordFormDirty({ content: "", recordType: 1, attachmentCID: "cid" })).toBe(true);
  });

  it("counts bytes and resolves ipfs attachment URLs", () => {
    expect(getByteLength("abc")).toBe(3);
    expect(getByteLength("中")).toBe(3);
    expect(resolveAttachmentUrl("ipfs://bafy")).toBe("https://ipfs.io/ipfs/bafy");
    expect(resolveAttachmentUrl("https://example.test/file")).toBe("https://example.test/file");
  });
});
