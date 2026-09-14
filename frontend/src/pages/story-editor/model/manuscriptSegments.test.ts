import { describe, expect, it } from "vitest";
import { segmentManuscript, summariseCollapsedTypes } from "./manuscriptSegments";

const records = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ recordIndex: i, recordType: 1 }));
const ids = (list: { recordIndex: number }[]) => list.map((c) => c.recordIndex);

describe("segmentManuscript", () => {
  it("leaves short manuscripts whole", () => {
    for (const n of [0, 1, 3, 5]) {
      const s = segmentManuscript(records(n));
      expect(s.head).toHaveLength(n);
      expect(s.collapsed).toEqual([]);
      expect(s.tail).toEqual([]);
    }
  });

  it("folds the middle once it hides at least three entries", () => {
    const s = segmentManuscript(records(6));
    expect(ids(s.head)).toEqual([0, 1]);
    expect(ids(s.collapsed)).toEqual([2, 3, 4]);
    expect(ids(s.tail)).toEqual([5]);
  });

  it("keeps the opening and the most recent entry in view", () => {
    const s = segmentManuscript(records(10));
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
      [{ recordType: 3 }, { recordType: 5 }, { recordType: 3 }, { recordType: 7 }],
      label,
    );
    expect(r).toEqual({ labels: ["type-3", "type-5", "type-7"], truncated: false });
  });

  it("caps the list and flags the remainder", () => {
    const r = summariseCollapsedTypes(
      [1, 2, 3, 4, 5, 6].map((recordType) => ({ recordType })),
      label,
    );
    expect(r.labels).toHaveLength(4);
    expect(r.truncated).toBe(true);
  });
});
