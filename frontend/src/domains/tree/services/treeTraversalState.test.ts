import { describe, expect, it } from "vitest";
import {
  applyEdgeStrictUpserts,
  applyEdgeUnionUpserts,
  applyNodeUpserts,
  bufferMissingNode,
  buildTreeFetchRunKey,
  createTreeProgress,
  isParentReachable,
  mergeChildNodeIds,
  mergeEdgeUpserts,
  pushTraversalChildren,
  shouldFlushTraversalWork,
  snapshotAndClearUpserts,
} from "./treeTraversalState";

describe("treeSessionState", () => {
  it("builds a stable fetch run key", () => {
    expect(
      buildTreeFetchRunKey({
        rootId: "0xabc-v-1",
        childrenMode: "strict",
        strictIncludeUnversionedChildren: true,
        traversal: "bfs",
        refreshTick: 2,
      }),
    ).toBe("build-0xabc-v-1-strict-v0-bfs-2");
  });

  it("checks parent reachability by id or hash", () => {
    expect(isParentReachable(["0xaaa-v-1", "0xbbb-v-2"], "0xaaa-v-1", null)).toBe(true);
    expect(isParentReachable(["0xaaa-v-1", "0xbbb-v-2"], null, "0xbbb")).toBe(true);
    expect(isParentReachable(["0xaaa-v-1"], null, "0xccc")).toBe(false);
  });

  it("applies node upserts without clobbering existing fields", () => {
    const out = applyNodeUpserts(
      {
        "0xaaa-v-1": {
          personHash: "0xaaa",
          versionIndex: 1,
          id: "0xaaa-v-1",
          fullName: "Alice",
        },
      },
      {
        "0xaaa-v-1": {
          personHash: "0xaaa",
          versionIndex: 1,
          id: "0xaaa-v-1",
        },
        "0xbbb-v-2": {
          personHash: "0xbbb",
          versionIndex: 2,
          id: "0xbbb-v-2",
        },
      },
    );

    expect(out["0xaaa-v-1"]?.fullName).toBe("Alice");
    expect(out["0xbbb-v-2"]).toMatchObject({ personHash: "0xbbb", versionIndex: 2 });
  });

  it("merges child ids with dedupe and sort", () => {
    expect(mergeChildNodeIds(["0xbbb-v-2"], ["0xaaa-v-1", "0xbbb-v-2"])).toEqual([
      "0xaaa-v-1",
      "0xbbb-v-2",
    ]);
  });

  it("handles traversal batching helpers", () => {
    expect(shouldFlushTraversalWork(100, 0, 10, { intervalMs: 60, batchSize: 50 })).toBe(true);
    expect(shouldFlushTraversalWork(20, 0, 7, { intervalMs: 60, batchSize: 50 })).toBe(false);
    expect(createTreeProgress(12, 3)).toEqual({ created: 12, visited: 12, depth: 3 });
  });

  it("buffers missing nodes and pushes traversal children", () => {
    const nodeUpserts: Record<string, any> = {};
    bufferMissingNode(nodeUpserts, {}, "0xaaa-v-1");
    bufferMissingNode(nodeUpserts, {}, "0xaaa-v-1");
    expect(nodeUpserts["0xaaa-v-1"]).toMatchObject({
      personHash: "0xaaa",
      versionIndex: 1,
    });

    const frontier: Array<{ id: string; depth: number }> = [];
    pushTraversalChildren(frontier, ["0xbbb-v-2", "0xccc-v-3"], 4);
    expect(frontier).toEqual([
      { id: "0xbbb-v-2", depth: 4 },
      { id: "0xccc-v-3", depth: 4 },
    ]);
  });

  it("snapshots and merges edge upserts", () => {
    const expectedNode = { personHash: "0xaaa", versionIndex: 1, id: "0xaaa-v-1" };
    const nodeUpserts = {
      "0xaaa-v-1": expectedNode,
    };
    const snap = snapshotAndClearUpserts(nodeUpserts);
    expect(snap).toEqual({ "0xaaa-v-1": expectedNode });
    expect(nodeUpserts).toEqual({});

    const strictTarget: Record<string, any> = {};
    mergeEdgeUpserts(strictTarget, { "0xaaa-v-1": { childIds: [], fetchedAt: 1 } });
    expect(strictTarget["0xaaa-v-1"]).toBeTruthy();

    expect(applyEdgeUnionUpserts({}, { "0xaaa": { childIds: [], fetchedAt: 1 } })).toEqual({
      "0xaaa": { childIds: [], fetchedAt: 1 },
    });
    expect(
      applyEdgeStrictUpserts({}, { "0xaaa-v-1": { childIds: [], fetchedAt: 1 } }),
    ).toEqual({
      "0xaaa-v-1": { childIds: [], fetchedAt: 1 },
    });
  });
});
