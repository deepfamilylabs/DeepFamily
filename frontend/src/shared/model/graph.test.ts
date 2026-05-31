import { describe, expect, it } from "vitest";
import { makeNodeId, sortNodeIdsByBirthOrder, type NodeData } from "./graph";

function makeHash(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function person(index: number, birth?: Partial<NodeData>): { id: string; data: NodeData } {
  const personHash = makeHash(index);
  const id = makeNodeId(personHash, 1);
  return {
    id,
    data: { id, personHash, versionIndex: 1, ...birth },
  };
}

describe("sortNodeIdsByBirthOrder", () => {
  it("orders eldest-first by birth year/month/day", () => {
    const a = person(1, { birthYear: 1990, birthMonth: 6 });
    const b = person(2, { birthYear: 1985 });
    const c = person(3, { birthYear: 1990, birthMonth: 2 });
    const nodesData = { [a.id]: a.data, [b.id]: b.data, [c.id]: c.data };

    expect(sortNodeIdsByBirthOrder([a.id, b.id, c.id], nodesData)).toEqual([b.id, c.id, a.id]);
  });

  it("treats BC years as earlier than AD years", () => {
    const bc = person(1, { birthYear: 100, isBirthBC: true });
    const ad = person(2, { birthYear: 50 });
    const nodesData = { [bc.id]: bc.data, [ad.id]: ad.data };

    expect(sortNodeIdsByBirthOrder([ad.id, bc.id], nodesData)).toEqual([bc.id, ad.id]);
  });

  it("sorts nodes with a known birth date before those without", () => {
    const known = person(1, { birthYear: 1900 });
    const unknown = person(2, {});
    const nodesData = { [known.id]: known.data, [unknown.id]: unknown.data };

    expect(sortNodeIdsByBirthOrder([unknown.id, known.id], nodesData)).toEqual([
      known.id,
      unknown.id,
    ]);
  });

  it("keeps original order for equal or missing birth dates (stable, drops nobody)", () => {
    const a = person(1, { birthYear: 1950 });
    const b = person(2, { birthYear: 1950 });
    const c = person(3, {});
    const d = person(4, {});
    const nodesData = { [a.id]: a.data, [b.id]: b.data, [c.id]: c.data, [d.id]: d.data };

    // a/b tie on 1950 -> stored order; c/d both unknown -> stored order, after the dated pair.
    expect(sortNodeIdsByBirthOrder([b.id, a.id, d.id, c.id], nodesData)).toEqual([
      b.id,
      a.id,
      d.id,
      c.id,
    ]);
  });

  it("returns the input unchanged for 0 or 1 ids", () => {
    const a = person(1, { birthYear: 1950 });
    expect(sortNodeIdsByBirthOrder([], {})).toEqual([]);
    expect(sortNodeIdsByBirthOrder([a.id], { [a.id]: a.data })).toEqual([a.id]);
  });
});
