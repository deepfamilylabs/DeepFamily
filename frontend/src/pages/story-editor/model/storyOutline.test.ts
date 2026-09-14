import { describe, expect, it } from "vitest";
import {
  buildStoryOutline,
  sortRecordsForReading,
  storyRecordAnchorId,
  type StoryOutlineItem,
} from "./storyOutline";

const label = (value: number) => `type-${value}`;
const t = (_key: string, fallback: string) => fallback;

const shape = (outline: StoryOutlineItem[]) =>
  outline.map((item) =>
    item.kind === "group"
      ? `[${item.label}]`
      : item.kind === "draft"
        ? `draft#${item.displayIndex}`
        : item.displayIndex,
  );

const interleaved = [
  { recordIndex: 0, displayIndex: 1, recordType: 16 }, // Closing
  { recordIndex: 1, displayIndex: 2, recordType: 2 }, // Early Years
  { recordIndex: 2, displayIndex: 3, recordType: 1 }, // Opening, written third
  { recordIndex: 3, displayIndex: 4, recordType: 3 }, // Early Years
  { recordIndex: 4, displayIndex: 5, recordType: 16 }, // Closing
];

describe("buildStoryOutline in reading order", () => {
  it("orders records the way the published profile reads them, not the way they were appended", () => {
    expect(shape(buildStoryOutline(interleaved, label, t))).toEqual([
      "[Opening]",
      3,
      "[Early Years]",
      2,
      4,
      "[Closing]",
      1,
      5,
    ]);
  });

  it("gives a group one heading however its records interleave on chain", () => {
    const outline = buildStoryOutline(
      [
        { recordIndex: 0, displayIndex: 1, recordType: 1 },
        { recordIndex: 1, displayIndex: 2, recordType: 19 },
        { recordIndex: 2, displayIndex: 3, recordType: 1 },
      ],
      label,
      t,
    );

    const groups = outline.filter((item) => item.kind === "group").map((item) => item.label);
    expect(groups).toEqual(["Opening", "Closing"]);
    expect(new Set(outline.map((item) => item.key)).size).toBe(outline.length);
  });

  it("places a Summary draft at the top, where it will be read", () => {
    const outline = buildStoryOutline(
      [
        { recordIndex: 0, displayIndex: 1, recordType: 16 },
        { recordIndex: 1, displayIndex: 2, recordType: 4 },
      ],
      label,
      t,
      { draft: { recordType: 1, displayIndex: 3 } },
    );

    expect(shape(outline)).toEqual(["[Opening]", "draft#3", "[Main Narrative]", 2, "[Closing]", 1]);
  });

  it("puts a draft after the records of its own type already written", () => {
    const outline = buildStoryOutline(
      [
        { recordIndex: 0, displayIndex: 1, recordType: 1 },
        { recordIndex: 1, displayIndex: 2, recordType: 2 },
        { recordIndex: 2, displayIndex: 3, recordType: 1 },
      ],
      label,
      t,
      { draft: { recordType: 1, displayIndex: 4 } },
    );

    expect(shape(outline)).toEqual(["[Opening]", 1, 3, "draft#4", "[Early Years]", 2]);
  });

  it("buckets unknown record types after the taxonomy without dropping them", () => {
    const outline = buildStoryOutline(
      [
        { recordIndex: 0, displayIndex: 1, recordType: 99 },
        { recordIndex: 1, displayIndex: 2, recordType: 16 },
      ],
      label,
      t,
    );

    expect(outline).toEqual([
      { kind: "group", key: "group-closing-1", label: "Closing" },
      {
        kind: "record",
        key: "record-1",
        recordIndex: 1,
        displayIndex: 2,
        recordType: 16,
        label: "type-16",
      },
      { kind: "group", key: "group-other-2", label: "Unknown" },
      {
        kind: "record",
        key: "record-0",
        recordIndex: 0,
        displayIndex: 1,
        recordType: 99,
        label: "type-99",
      },
    ]);
  });
});

describe("buildStoryOutline in the order written", () => {
  it("follows the chain with a heading for each run of a group", () => {
    expect(shape(buildStoryOutline(interleaved, label, t, { order: "written" }))).toEqual([
      "[Closing]",
      1,
      "[Early Years]",
      2,
      "[Opening]",
      3,
      "[Early Years]",
      4,
      "[Closing]",
      5,
    ]);
  });

  it("keeps keys unique when a group comes back later", () => {
    const outline = buildStoryOutline(interleaved, label, t, { order: "written" });
    expect(new Set(outline.map((item) => item.key)).size).toBe(outline.length);
  });

  it("appends the draft at the end, where the chain will put it", () => {
    const outline = buildStoryOutline(
      [
        { recordIndex: 0, displayIndex: 1, recordType: 16 },
        { recordIndex: 1, displayIndex: 2, recordType: 4 },
      ],
      label,
      t,
      { order: "written", draft: { recordType: 4, displayIndex: 3 } },
    );

    expect(shape(outline)).toEqual(["[Closing]", 1, "[Main Narrative]", 2, "draft#3"]);
  });
});

describe("sortRecordsForReading", () => {
  it("sorts a copy into reading order and leaves the chain order alone", () => {
    const sorted = sortRecordsForReading(interleaved);
    expect(sorted.map((record) => record.recordIndex)).toEqual([2, 1, 3, 0, 4]);
    expect(interleaved.map((record) => record.recordIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});

it("labels the draft with its title once it has one", () => {
  const [, untitled] = buildStoryOutline([], label, t, {
    draft: { recordType: 1, displayIndex: 1 },
  });
  const [, titled] = buildStoryOutline([], label, t, {
    draft: { title: "第一次远行", recordType: 1, displayIndex: 1 },
  });

  expect(untitled).toMatchObject({ kind: "draft", label: "type-1" });
  expect(titled).toMatchObject({ kind: "draft", label: "第一次远行" });
});

it("derives a stable anchor id per record", () => {
  expect(storyRecordAnchorId(4)).toBe("story-record-4");
});

it("uses each record title in the directory and falls back only for blank titles", () => {
  const outline = buildStoryOutline(
    [
      { title: "  First journey 😀  ", recordIndex: 4, displayIndex: 1, recordType: 4 },
      { title: "", recordIndex: 5, displayIndex: 2, recordType: 4 },
      { title: " \n ", recordIndex: 6, displayIndex: 3, recordType: 4 },
    ],
    label,
    t,
  ).filter((item) => item.kind === "record");
  expect(outline.map((item) => item.label)).toEqual(["  First journey 😀  ", "type-4", "type-4"]);
  expect(outline.map((item) => item.recordIndex)).toEqual([4, 5, 6]);
});
