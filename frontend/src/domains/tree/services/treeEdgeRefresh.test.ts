import { describe, expect, it, vi } from "vitest";
import { reloadInvalidatedTreeEdges } from "./treeEdgeRefresh";

describe("treeEdgeRefresh", () => {
  it("reloads reachable union and strict parents and accumulates child ids", async () => {
    const onTotalVersions = vi.fn();
    const result = await reloadInvalidatedTreeEdges({
      api: {
        listChildrenUnionAll: vi.fn(async (_parentHash, options) => {
          options.onTotalVersions?.(3);
          return {
            childIds: ["0xchild-v-1"],
            totalVersions: 3,
          };
        }),
        listChildrenStrictAll: vi.fn(async () => ["0xstrict-v-1"]),
      },
      invalidation: {
        totalVersionsKeys: [],
        unionKeys: ["0xaaa"],
        strictKeys: ["0xaaa-v-1"],
        strictPrefixes: [],
      },
      reachableNodeIds: ["0xaaa-v-1"],
      edgesStrict: {
        "0xaaa-v-1": { childIds: [], fetchedAt: 1 },
      },
      childrenPageLimit: 50,
      totalVersionsTtlMs: 60_000,
      onTotalVersions,
    });

    expect(result.unionUpserts["0xaaa"]?.childIds).toEqual(["0xchild-v-1"]);
    expect(result.strictUpserts["0xaaa-v-1"]?.childIds).toEqual(["0xstrict-v-1"]);
    expect(result.newReachableChildren.sort()).toEqual(["0xchild-v-1", "0xstrict-v-1"]);
    expect(onTotalVersions).toHaveBeenCalledWith("0xaaa", 3);
  });

  it("skips unreachable invalidations", async () => {
    const api = {
      listChildrenUnionAll: vi.fn(),
      listChildrenStrictAll: vi.fn(),
    };
    const result = await reloadInvalidatedTreeEdges({
      api,
      invalidation: {
        totalVersionsKeys: [],
        unionKeys: ["0xaaa"],
        strictKeys: ["0xaaa-v-1"],
        strictPrefixes: [],
      },
      reachableNodeIds: ["0xbbb-v-1"],
      edgesStrict: {
        "0xaaa-v-1": { childIds: [], fetchedAt: 1 },
      },
      childrenPageLimit: 50,
      totalVersionsTtlMs: 60_000,
    });

    expect(api.listChildrenUnionAll).not.toHaveBeenCalled();
    expect(api.listChildrenStrictAll).not.toHaveBeenCalled();
    expect(result.newReachableChildren).toEqual([]);
  });
});
