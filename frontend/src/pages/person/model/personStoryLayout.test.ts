import { describe, expect, it } from "vitest";
import type { StoryRecord } from "../../../shared/model";
import {
  SECTION_HEAD_COUNT,
  buildPersonContents,
  getRecordExcerpt,
  isRecordFolded,
  sortSectionsForReading,
  splitQuoteSource,
  splitReferenceLink,
  splitSectionRecords,
  summariseRecordTitles,
} from "./personStoryLayout";

const zeroHash = `0x${"0".repeat(64)}`;

function makeRecord(overrides: Partial<StoryRecord>): StoryRecord {
  return {
    title: "",
    recordIndex: 0,
    payloadHash: zeroHash,
    content: "hello",
    timestamp: 1,
    author: "0x0000000000000000000000000000000000000000",
    recordType: 1,
    attachmentCID: "",
    ...overrides,
  };
}

const run = (count: number) =>
  Array.from({ length: count }, (_, index) => makeRecord({ recordIndex: index }));

describe("personStoryLayout", () => {
  it("folds only sections longer than the threshold, keeping the head in view", () => {
    expect(splitSectionRecords(run(5), false)).toMatchObject({ hidden: [] });
    const folded = splitSectionRecords(run(8), false);
    expect(folded.visible).toHaveLength(SECTION_HEAD_COUNT);
    expect(folded.hidden.map((record) => record.recordIndex)).toEqual([3, 4, 5, 6, 7]);
    expect(splitSectionRecords(run(8), true).hidden).toEqual([]);
  });

  it("knows which records sit behind a collapsed fold", () => {
    expect(isRecordFolded(run(8), 2)).toBe(false);
    expect(isRecordFolded(run(8), 3)).toBe(true);
    expect(isRecordFolded(run(5), 4)).toBe(false);
  });

  it("summarises folded records by their titles only", () => {
    const records = [
      makeRecord({ title: "Birth" }),
      makeRecord({ title: "  " }),
      makeRecord({ title: "School" }),
      makeRecord({ title: "War" }),
    ];
    expect(summariseRecordTitles(records, 2)).toEqual({ titles: ["Birth", "School"], truncated: true });
    expect(summariseRecordTitles(records)).toEqual({
      titles: ["Birth", "School", "War"],
      truncated: false,
    });
  });

  it("cuts excerpts by code point and flattens whitespace", () => {
    expect(getRecordExcerpt("short\n text")).toBe("short text");
    expect(getRecordExcerpt("184年：黄巾起义爆发后任骑都尉，参加颍川作战", 10)).toBe("184年：黄巾起义爆…");
  });

  it("splits a quote from its source at the last em-dash pair", () => {
    expect(splitQuoteSource("“唯才是举，吾得而用之。”——《求贤令》")).toEqual({
      quote: "“唯才是举，吾得而用之。”",
      source: "《求贤令》",
    });
    expect(splitQuoteSource("A plain line")).toEqual({ quote: "A plain line" });
    expect(splitQuoteSource("——only a source")).toEqual({ quote: "——only a source" });
  });

  it("finds http links in references and never returns other protocols", () => {
    expect(splitReferenceLink("《三国志·魏书一·武帝纪》：https://zh.wikisource.org/wiki/三國志/卷01")).toEqual({
      label: "《三国志·魏书一·武帝纪》",
      url: "https://zh.wikisource.org/wiki/%E4%B8%89%E5%9C%8B%E5%BF%97/%E5%8D%B701",
      displayUrl: "zh.wikisource.org/wiki/三國志/卷01",
    });
    expect(splitReferenceLink("Book, 1901")).toEqual({ label: "Book, 1901" });
    expect(splitReferenceLink("javascript:alert(1)")).toEqual({ label: "javascript:alert(1)" });
  });

  it("orders sections by the reading taxonomy and heads each group once", () => {
    const groups = [
      { type: 0, records: [makeRecord({ recordType: 0 })] },
      { type: 3, records: [makeRecord({ recordType: 3 })] },
      { type: 2, records: [makeRecord({ recordType: 2 })] },
      { type: 1, records: [makeRecord({ recordType: 1 })] },
    ];
    expect(sortSectionsForReading(groups).map((group) => group.type)).toEqual([1, 2, 3, 0]);
    expect(
      buildPersonContents(groups).map((item) => (item.kind === "group" ? item.id : item.type)),
    ).toEqual(["opening", 1, "earlyYears", 2, 3, "other", 0]);
  });
});
