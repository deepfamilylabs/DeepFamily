import { describe, expect, it } from "vitest";
import { makeNodeId, type NodeData } from "../../../shared/model";
import type { TreeGraphData } from "./buildViewGraph";
import { buildSpouseLinks, pickBestVersionIndex } from "./spouseLinks";

function makeHash(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

const husbandHash = makeHash(1);
const wifeHash = makeHash(2);
const childAHash = makeHash(3);
const childBHash = makeHash(4);
const husbandId = makeNodeId(husbandHash, 1);
const childAId = makeNodeId(childAHash, 1);
const childBId = makeNodeId(childBHash, 1);

function makeGraph(childIds: string[]): TreeGraphData {
  return {
    nodes: [
      { id: husbandId, depth: 0, personHash: husbandHash, versionIndex: 1 },
      ...childIds.map((id, i) => ({
        id,
        depth: 1,
        personHash: [childAHash, childBHash][i],
        versionIndex: 1,
      })),
    ],
    edges: [],
    childrenByParent: { [husbandId]: childIds },
  };
}

function childNode(id: string, personHash: string, motherVersionIndex: number): NodeData {
  return {
    id,
    personHash,
    versionIndex: 1,
    fatherHash: husbandHash,
    fatherVersionIndex: 1,
    motherHash: wifeHash,
    motherVersionIndex,
  };
}

describe("pickBestVersionIndex", () => {
  it("picks the highest endorsement count, breaking ties by smallest version", () => {
    expect(
      pickBestVersionIndex([
        { versionIndex: 1, endorsementCount: 2 },
        { versionIndex: 2, endorsementCount: 5 },
        { versionIndex: 3, endorsementCount: 5 },
      ]),
    ).toBe(2);
  });

  it("returns the only version, and null when empty", () => {
    expect(pickBestVersionIndex([{ versionIndex: 4, endorsementCount: 0 }])).toBe(4);
    expect(pickBestVersionIndex([])).toBeNull();
  });
});

describe("buildSpouseLinks", () => {
  it("maps a person to the co-parent derived from a child's recorded parents", () => {
    const graph = makeGraph([childAId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: childNode(childAId, childAHash, 1),
    };
    expect(buildSpouseLinks({ graph, nodesData }).get(husbandId)).toEqual([makeNodeId(wifeHash, 1)]);
  });

  it("trusts a single concrete version agreed across children", () => {
    const graph = makeGraph([childAId, childBId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: childNode(childAId, childAHash, 2),
      [childBId]: childNode(childBId, childBHash, 2),
    };
    expect(buildSpouseLinks({ graph, nodesData }).get(husbandId)).toEqual([makeNodeId(wifeHash, 2)]);
  });

  it("upgrades a first-seen v0 co-parent to a concrete version pinned by a later child", () => {
    const graph = makeGraph([childAId, childBId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      // childA records the wife as v0 (unversioned sentinel) ...
      [childAId]: childNode(childAId, childAHash, 0),
      // ... childB pins her concrete version; prefer that over the v0 sentinel.
      [childBId]: childNode(childBId, childBHash, 4),
    };
    // resolveVersion would only fire for a leftover v0; here it must not be needed.
    expect(buildSpouseLinks({ graph, nodesData }).get(husbandId)).toEqual([makeNodeId(wifeHash, 4)]);
  });

  it("resolves a concrete-vs-concrete conflict to the most-endorsed version", () => {
    // childA pins the wife's v2, childB pins v5; v5 is the more endorsed record, so it wins
    // (the larger version number is irrelevant — endorsement decides).
    const graph = makeGraph([childAId, childBId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: childNode(childAId, childAHash, 2),
      [childBId]: childNode(childBId, childBHash, 5),
      [makeNodeId(wifeHash, 2)]: {
        id: makeNodeId(wifeHash, 2),
        personHash: wifeHash,
        versionIndex: 2,
        endorsementCount: 1,
      },
      [makeNodeId(wifeHash, 5)]: {
        id: makeNodeId(wifeHash, 5),
        personHash: wifeHash,
        versionIndex: 5,
        endorsementCount: 4,
      },
    };
    expect(buildSpouseLinks({ graph, nodesData }).get(husbandId)).toEqual([makeNodeId(wifeHash, 5)]);
  });

  it("falls back to the smallest conflicting version when endorsements have not loaded yet", () => {
    // No endorsement counts in nodesData and the earliest child pins the larger version; the tie
    // breaks to the smallest version deterministically, independent of child order.
    const graph = makeGraph([childAId, childBId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: childNode(childAId, childAHash, 5),
      [childBId]: childNode(childBId, childBHash, 2),
    };
    expect(buildSpouseLinks({ graph, nodesData }).get(husbandId)).toEqual([makeNodeId(wifeHash, 2)]);
  });

  it("maps an unversioned (v0) co-parent through resolveVersion", () => {
    const graph = makeGraph([childAId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: childNode(childAId, childAHash, 0),
    };
    const links = buildSpouseLinks({
      graph,
      nodesData,
      resolveVersion: (_hash, raw) => (raw === 0 ? 3 : raw),
    });
    expect(links.get(husbandId)).toEqual([makeNodeId(wifeHash, 3)]);
  });

  it("omits people with no derivable spouse", () => {
    const graph = makeGraph([childAId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: { id: childAId, personHash: childAHash, versionIndex: 1 },
    };
    expect(buildSpouseLinks({ graph, nodesData }).has(husbandId)).toBe(false);
  });

  it("skips the all-zero parent hash (no parent recorded)", () => {
    const graph = makeGraph([childAId]);
    const nodesData: Record<string, NodeData> = {
      [husbandId]: { id: husbandId, personHash: husbandHash, versionIndex: 1 },
      [childAId]: {
        id: childAId,
        personHash: childAHash,
        versionIndex: 1,
        fatherHash: husbandHash,
        fatherVersionIndex: 1,
        motherHash: `0x${"0".repeat(64)}`,
        motherVersionIndex: 0,
      },
    };
    expect(buildSpouseLinks({ graph, nodesData }).has(husbandId)).toBe(false);
  });
});
