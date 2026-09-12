import { describe, expect, it } from "vitest";
import { buildStoryOutline, storyChunkAnchorId } from "./storyOutline";

const label = (value: number) => `type-${value}`;
const t = (_key: string, fallback: string) => fallback;

describe("buildStoryOutline", () => {
  it("emits one group heading per run and keeps document order", () => {
    const outline = buildStoryOutline(
      [
        { chunkIndex: 0, displayIndex: 1, chunkType: 1 }, // Opening
        { chunkIndex: 1, displayIndex: 2, chunkType: 2 }, // Early Years
        { chunkIndex: 2, displayIndex: 3, chunkType: 3 }, // Early Years
        { chunkIndex: 3, displayIndex: 4, chunkType: 16 }, // Closing
      ],
      label,
      t,
    );

    expect(
      outline.map((item) => (item.kind === "group" ? `[${item.label}]` : item.displayIndex)),
    ).toEqual(["[Opening]", 1, "[Early Years]", 2, 3, "[Closing]", 4]);
  });

  it("repeats a heading when the same group comes back later", () => {
    const outline = buildStoryOutline(
      [
        { chunkIndex: 0, displayIndex: 1, chunkType: 1 }, // Opening
        { chunkIndex: 1, displayIndex: 2, chunkType: 19 }, // Closing
        { chunkIndex: 2, displayIndex: 3, chunkType: 1 }, // Opening again
      ],
      label,
      t,
    );

    const groups = outline.filter((item) => item.kind === "group").map((item) => item.label);
    expect(groups).toEqual(["Opening", "Closing", "Opening"]);
    expect(new Set(outline.map((item) => item.key)).size).toBe(outline.length);
  });

  it("buckets unknown chunk types without dropping them", () => {
    const outline = buildStoryOutline(
      [{ chunkIndex: 0, displayIndex: 1, chunkType: 99 }],
      label,
      t,
    );

    expect(outline).toEqual([
      { kind: "group", key: "group-other-1", label: "Unknown" },
      {
        kind: "chunk",
        key: "chunk-0",
        chunkIndex: 0,
        displayIndex: 1,
        chunkType: 99,
        label: "type-99",
      },
    ]);
  });

  it("derives a stable anchor id per chunk", () => {
    expect(storyChunkAnchorId(4)).toBe("story-chunk-4");
  });
});
