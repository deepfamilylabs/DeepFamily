import { describe, expect, it, vi } from "vitest";
import {
  createTreeEdgeRevalidators,
  createTreeSessionEdgeLoaders,
  ensureTreeReachableChildren,
} from "./treeSessionEdges";

describe("treeSessionEdges", () => {
  it("loads strict and union children with total version hooks", async () => {
    const onTotalVersions = vi.fn();
    const onStrictFetched = vi.fn();
    const onUnionFetched = vi.fn();

    const { loadChildrenStrict, loadChildrenUnion } = createTreeSessionEdgeLoaders({
      api: {
        listChildrenStrictAll: vi.fn(async () => ["0xbbb-v-1"]),
        listChildrenUnionAll: vi.fn(async (_parentHash, options) => {
          options.onTotalVersions?.(2);
          return {
            childIds: ["0xccc-v-1"],
            totalVersions: 2,
          };
        }),
      },
      getEdgesStrict: () => ({}),
      getEdgesUnion: () => ({}),
      edgeTtlMs: 60_000,
      totalVersionsTtlMs: 30_000,
      childrenPageLimit: 50,
      checkAbort: vi.fn(),
      onStrictFetched,
      onUnionFetched,
      onTotalVersions,
    });

    expect(await loadChildrenStrict("0xaaa-v-1", true)).toMatchObject({
      childIds: ["0xbbb-v-1"],
      totalCount: 1,
    });
    expect(await loadChildrenUnion("0xaaa", true)).toMatchObject({
      childIds: ["0xccc-v-1"],
      totalVersions: 2,
    });
    expect(onTotalVersions).toHaveBeenCalledWith("0xaaa", 2);
    expect(onStrictFetched).toHaveBeenCalled();
    expect(onUnionFetched).toHaveBeenCalled();
  });

  it("adds reachable child placeholders only when parent is reachable", () => {
    let nodesData: Record<string, any> = {};
    let reachableNodeIds: string[] = ["0xaaa-v-1"];

    ensureTreeReachableChildren({
      reachableNodeIds,
      parentId: "0xaaa-v-1",
      parentHash: null,
      childIds: ["0xbbb-v-1"],
      setNodesData: (updater) => {
        nodesData = updater(nodesData);
      },
      setReachableNodeIds: (updater) => {
        reachableNodeIds = updater(reachableNodeIds);
      },
    });

    expect(nodesData["0xbbb-v-1"]).toMatchObject({ personHash: "0xbbb", versionIndex: 1 });
    expect(reachableNodeIds).toEqual(["0xaaa-v-1", "0xbbb-v-1"]);
  });

  it("revalidates strict and union edges without duplicate inflight work", async () => {
    let edgesStrict: Record<string, any> = {};
    let edgesUnion: Record<string, any> = {};
    let nodesData: Record<string, any> = {};
    let reachableNodeIds = ["0xaaa-v-1"];
    const loadChildrenStrict = vi.fn(async () => ({ childIds: ["0xbbb-v-1"], fetchedAt: 1 }));
    const loadChildrenUnion = vi.fn(async () => ({ childIds: ["0xccc-v-1"], fetchedAt: 2 }));

    const { revalidateStrict, revalidateUnion } = createTreeEdgeRevalidators({
      edgeRevalidate: new Set<string>(),
      loadChildrenStrict,
      loadChildrenUnion,
      getReachableNodeIds: () => reachableNodeIds,
      setNodesData: (updater) => {
        nodesData = updater(nodesData);
      },
      setReachableNodeIds: (updater) => {
        reachableNodeIds = updater(reachableNodeIds);
      },
      setEdgesStrict: (updater) => {
        edgesStrict = updater(edgesStrict);
      },
      setEdgesUnion: (updater) => {
        edgesUnion = updater(edgesUnion);
      },
    });

    revalidateStrict("0xaaa-v-1");
    revalidateStrict("0xaaa-v-1");
    revalidateUnion("0xaaa");
    revalidateUnion("0xaaa");
    await Promise.resolve();
    await Promise.resolve();

    expect(loadChildrenStrict).toHaveBeenCalledTimes(1);
    expect(loadChildrenUnion).toHaveBeenCalledTimes(1);
    expect(edgesStrict["0xaaa-v-1"]?.childIds).toEqual(["0xbbb-v-1"]);
    expect(edgesUnion["0xaaa"]?.childIds).toEqual(["0xccc-v-1"]);
    expect(nodesData["0xbbb-v-1"]).toBeTruthy();
    expect(nodesData["0xccc-v-1"]).toBeTruthy();
  });
});
