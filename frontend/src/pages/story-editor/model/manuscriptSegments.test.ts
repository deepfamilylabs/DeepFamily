import { describe, expect, it } from "vitest";
import { segmentManuscript, summariseCollapsedTypes } from "./manuscriptSegments";

const chunks = (n: number) => Array.from({ length: n }, (_, i) => ({ chunkIndex: i, chunkType: 1 }));
const ids = (list: { chunkIndex: number }[]) => list.map((c) => c.chunkIndex);

describe("segmentManuscript", () => {
  it("leaves short manuscripts whole", () => {
    for (const n of [0, 1, 3, 5]) {
      const s = segmentManuscript(chunks(n));
      expect(s.head).toHaveLength(n);
      expect(s.collapsed).toEqual([]);
      expect(s.tail).toEqual([]);
    }
  });

  it("folds the middle once it hides at least three entries", () => {
    const s = segmentManuscript(chunks(6));
    expect(ids(s.head)).toEqual([0, 1]);
    expect(ids(s.collapsed)).toEqual([2, 3, 4]);
    expect(ids(s.tail)).toEqual([5]);
  });

  it("keeps the opening and the most recent entry in view", () => {
    const s = segmentManuscript(chunks(10));
    expect(ids(s.head)).toEqual([0, 1]);
    expect(ids(s.collapsed)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(ids(s.tail)).toEqual([9]);
    expect([...s.head, ...s.collapsed, ...s.tail]).toHaveLength(10);
  });
});

describe("summariseCollapsedTypes", () => {
  const label = (v: number) => `type-${v}`;

  it("lists distinct types in document order", () => {
    const r = summariseCollapsedTypes(
      [{ chunkType: 3 }, { chunkType: 5 }, { chunkType: 3 }, { chunkType: 7 }],
      label,
    );
    expect(r).toEqual({ labels: ["type-3", "type-5", "type-7"], truncated: false });
  });

  it("caps the list and flags the remainder", () => {
    const r = summariseCollapsedTypes(
      [1, 2, 3, 4, 5, 6].map((chunkType) => ({ chunkType })),
      label,
    );
    expect(r.labels).toHaveLength(4);
    expect(r.truncated).toBe(true);
  });
});
