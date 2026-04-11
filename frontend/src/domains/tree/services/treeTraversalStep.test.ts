import { describe, expect, it, vi } from "vitest";
import { resolveTreeTraversalChildIds } from "./treeTraversalStep";

describe("treeTraversalStep", () => {
  it("uses cached strict entries and triggers stale revalidation hooks", async () => {
    const onStrictCacheHit = vi.fn();
    const onStrictStale = vi.fn();
    const result = await resolveTreeTraversalChildIds({
      nodeId: "0xaaa-v-1",
      childrenMode: "strict",
      strictIncludeUnversionedChildren: true,
      edgeTtlMs: 1,
      edgesStrict: {
        "0xaaa-v-1": { childIds: ["0xbbb-v-1"], fetchedAt: 0 },
        "0xaaa-v-0": { childIds: ["0xccc-v-1"], fetchedAt: 0 },
      },
      edgesUnion: {},
      loadChildrenStrict: vi.fn(),
      loadChildrenUnion: vi.fn(),
      onStrictCacheHit,
      onStrictStale,
    });

    expect(result.childIds).toEqual(["0xbbb-v-1", "0xccc-v-1"]);
    expect(onStrictCacheHit).toHaveBeenCalledTimes(2);
    expect(onStrictStale).toHaveBeenNthCalledWith(1, "0xaaa-v-1");
    expect(onStrictStale).toHaveBeenNthCalledWith(2, "0xaaa-v-0");
  });

  it("loads and records union misses", async () => {
    const loadChildrenUnion = vi.fn(async () => ({
      childIds: ["0xbbb-v-1"],
      fetchedAt: Date.now(),
      totalVersions: 2,
    }));

    const result = await resolveTreeTraversalChildIds({
      nodeId: "0xaaa-v-1",
      childrenMode: "union",
      strictIncludeUnversionedChildren: false,
      edgeTtlMs: 60_000,
      edgesStrict: {},
      edgesUnion: {},
      loadChildrenStrict: vi.fn(),
      loadChildrenUnion,
      onUnionCacheMiss: vi.fn(),
    });

    expect(loadChildrenUnion).toHaveBeenCalledWith("0xaaa", true);
    expect(result.childIds).toEqual(["0xbbb-v-1"]);
    expect(result.unionUpserts["0xaaa"]?.totalVersions).toBe(2);
  });
});
