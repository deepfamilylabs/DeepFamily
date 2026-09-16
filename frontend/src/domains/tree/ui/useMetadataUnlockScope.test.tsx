// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeNodeId, mergeValidatedMetadataUnlock, type NodeData } from "../../../shared/model";
import type { TreeGraphDataValue } from "../context/treeContexts";
import { useMetadataUnlockScope } from "./useMetadataUnlockScope";

const mocks = vi.hoisted(() => ({
  tree: {} as TreeGraphDataValue,
  viz: {
    childrenMode: "strict" as "strict" | "union",
    strictIncludeUnversionedChildren: false,
    deduplicateChildren: false,
  },
}));

vi.mock("../context/treeContexts", () => ({ useTreeGraphData: () => mocks.tree }));
vi.mock("../context/TreeViewContext", () => ({ useTreeGraphData: () => mocks.tree }));
vi.mock("../context/VizOptionsContext", () => ({ useVizOptions: () => mocks.viz }));

function node(digit: string, versionIndex = 1): NodeData {
  const personHash = `0x${digit.repeat(64)}`;
  return { id: makeNodeId(personHash, versionIndex), personHash, versionIndex };
}

function unlocked(current: NodeData): NodeData {
  const anchors = {
    personHash: current.personHash,
    versionIndex: current.versionIndex,
    versionCommitment: "123",
    metadataPointer: `0x${"ab".repeat(20)}`,
    metadataPayloadHash: `0x${"cd".repeat(32)}`,
    metadataPayloadLength: 512,
    metadataSegmentCount: 1,
  };
  return mergeValidatedMetadataUnlock({ ...current, ...anchors }, anchors, {
    person: {
      personHash: current.personHash,
      fullName: `Person ${current.personHash}`,
      gender: 1,
      birthYear: 1980,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
    },
    parents: { father: null, mother: null },
    tag: "Tag",
    biography: "Biography",
    formatVersion: 1,
    identitySuiteId: 1,
  });
}

const root = node("1");
const child = node("2");
const otherRoot = node("3");
const otherChild = node("4");

describe("metadata unlock view scope", () => {
  beforeEach(() => {
    mocks.tree = {
      rootId: root.id,
      rootExists: true,
      reachableNodeIds: [root.id, child.id],
      endorsementsReady: true,
      trustedFilterActive: false,
      spouseVersionResolution: new Map(),
      nodesData: Object.fromEntries(
        [root, child, otherRoot, otherChild].map((item) => [item.id, item]),
      ),
      edgesStrict: {
        [root.id]: { childIds: [child.id], fetchedAt: 1 },
        [otherRoot.id]: { childIds: [otherChild.id], fetchedAt: 1 },
      },
      edgesUnion: {},
    };
    mocks.viz = {
      childrenMode: "strict",
      strictIncludeUnversionedChildren: false,
      deduplicateChildren: false,
    };
  });

  afterEach(cleanup);

  it("follows only the current root graph and excludes cached nodes from a previous root", () => {
    mocks.tree.nodesData = Object.fromEntries(
      [root, child, otherRoot, otherChild].map((item) => [item.id, unlocked(item)]),
    );
    const { result, rerender } = renderHook(() => useMetadataUnlockScope());
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id]));
    expect(result.current.unlockedCount).toBe(2);
    const initialKey = result.current.key;

    mocks.tree = { ...mocks.tree, rootId: otherRoot.id };
    rerender();
    expect(result.current.nodeIds).toEqual(new Set([otherRoot.id, otherChild.id]));
    expect(result.current.key).not.toBe(initialKey);
    expect(result.current.unlockedCount).toBe(2);
  });

  it.each([null, root.id])(
    "has an empty scope when root %s is missing or does not exist",
    (rootId) => {
      mocks.tree = { ...mocks.tree, rootId, rootExists: false };
      const { result } = renderHook(() => useMetadataUnlockScope({ includeSpouses: true }));
      expect(result.current.rootId).toBe(rootId);
      expect(result.current.nodeIds.size).toBe(0);
      expect(result.current.unlockedCount).toBe(0);
    },
  );

  it("honors strict, union and unversioned-child projection rules", () => {
    const unversionedChild = node("5");
    const unionChild = node("6");
    mocks.tree.edgesStrict[makeNodeId(root.personHash, 0)] = {
      childIds: [unversionedChild.id],
      fetchedAt: 1,
    };
    mocks.tree.edgesUnion[root.personHash] = { childIds: [child.id, unionChild.id], fetchedAt: 1 };
    const { result, rerender } = renderHook(() => useMetadataUnlockScope());
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id]));

    mocks.viz = { ...mocks.viz, strictIncludeUnversionedChildren: true };
    rerender();
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id, unversionedChild.id]));

    mocks.viz = { ...mocks.viz, childrenMode: "union" };
    rerender();
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id, unionChild.id]));
  });

  it("uses deduplicated versions from the graph instead of every cached version of a person", () => {
    const second = node("2", 2);
    mocks.tree.nodesData = {
      ...mocks.tree.nodesData,
      [child.id]: { ...child, endorsementCount: 1 },
      [second.id]: { ...second, endorsementCount: 5 },
    };
    mocks.tree.edgesStrict[root.id] = { childIds: [child.id, second.id], fetchedAt: 1 };
    mocks.viz.deduplicateChildren = true;
    const { result, rerender } = renderHook(() => useMetadataUnlockScope());
    expect(result.current.nodeIds).toEqual(new Set([root.id, second.id]));

    mocks.tree = { ...mocks.tree, endorsementsReady: false };
    rerender();
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id]));

    mocks.viz = { ...mocks.viz, deduplicateChildren: false };
    rerender();
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id, second.id]));
  });

  it("respects trusted-source filtering, including a filtered-out root", () => {
    const hidden = node("5");
    mocks.tree.edgesStrict[root.id] = { childIds: [child.id, hidden.id], fetchedAt: 1 };
    mocks.tree.trustedFilterActive = true;
    const { result, rerender } = renderHook(() => useMetadataUnlockScope());
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id]));

    mocks.tree = { ...mocks.tree, reachableNodeIds: [child.id, hidden.id] };
    rerender();
    expect(result.current.nodeIds.size).toBe(0);
  });

  it("adds only the projected book spouses, including a resolved married-in version", () => {
    const spouse = node("7", 5);
    const alternateSpouse = node("7", 2);
    mocks.tree.nodesData = {
      ...mocks.tree.nodesData,
      [root.id]: unlocked(root),
      [child.id]: {
        ...child,
        fatherHash: root.personHash,
        motherHash: spouse.personHash,
        motherVersionIndex: 0,
      },
      [spouse.id]: unlocked(spouse),
      [alternateSpouse.id]: unlocked(alternateSpouse),
    };
    mocks.tree.spouseVersionResolution.set(spouse.personHash, 5);
    mocks.tree.trustedFilterActive = true;
    const { result, rerender } = renderHook(
      ({ includeSpouses }) => useMetadataUnlockScope({ includeSpouses }),
      { initialProps: { includeSpouses: false } },
    );
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id]));
    expect(result.current.unlockedCount).toBe(1);

    rerender({ includeSpouses: true });
    expect(result.current.nodeIds).toEqual(new Set([root.id, child.id, spouse.id]));
    expect(result.current.unlockedCount).toBe(2);
    expect(result.current.nodeIds.has(alternateSpouse.id)).toBe(false);
  });

  it("keeps its key stable when names, birth dates or graph iteration order change", () => {
    const sibling = node("5");
    mocks.tree.edgesStrict[root.id] = { childIds: [child.id, sibling.id], fetchedAt: 1 };
    mocks.tree.nodesData[sibling.id] = sibling;
    const { result, rerender } = renderHook(() => useMetadataUnlockScope());
    const originalKey = result.current.key;

    mocks.tree = {
      ...mocks.tree,
      nodesData: {
        ...mocks.tree.nodesData,
        [child.id]: { ...child, fullName: "Child", birthYear: 1990, birthMonth: 1, birthDay: 1 },
        [sibling.id]: {
          ...sibling,
          fullName: "Elder sibling",
          birthYear: 1980,
          birthMonth: 1,
          birthDay: 1,
        },
      },
    };
    rerender();
    expect(result.current.key).toBe(originalKey);

    mocks.tree = {
      ...mocks.tree,
      edgesStrict: {
        ...mocks.tree.edgesStrict,
        [root.id]: { childIds: [sibling.id, child.id], fetchedAt: 2 },
      },
    };
    rerender();
    expect(result.current.key).toBe(originalKey);
  });
});
