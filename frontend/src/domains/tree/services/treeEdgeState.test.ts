import { describe, expect, it } from "vitest";
import {
  addPlaceholderNodes,
  collectReachableHashes,
  collectStrictParentIds,
  mergeReachableNodeIds,
  removeStrictEdges,
  removeUnionEdges,
  zeroVersionDetailFetchTimes,
} from "./treeEdgeState";

describe("treeEdgeState", () => {
  it("collects reachable hashes", () => {
    expect(collectReachableHashes(["0xabc-v-1", "0xdef-v-2"])).toEqual(
      new Set(["0xabc", "0xdef"]),
    );
  });

  it("collects strict parent ids from explicit keys and prefixes", () => {
    const out = collectStrictParentIds({
      strictKeys: ["0xaaa-v-1"],
      strictPrefixes: ["0xbbb-v-"],
      edgesStrict: {
        "0xbbb-v-2": { childIds: [], fetchedAt: 1 },
        "0xccc-v-1": { childIds: [], fetchedAt: 1 },
      },
    });

    expect(out).toEqual(new Set(["0xaaa-v-1", "0xbbb-v-2"]));
  });

  it("removes invalidated edge cache entries", () => {
    expect(
      removeUnionEdges(
        { "0xaaa": { childIds: [], fetchedAt: 1 }, "0xbbb": { childIds: [], fetchedAt: 1 } },
        ["0xaaa"],
      ),
    ).toEqual({ "0xbbb": { childIds: [], fetchedAt: 1 } });

    expect(
      removeStrictEdges({
        edgesStrict: {
          "0xaaa-v-1": { childIds: [], fetchedAt: 1 },
          "0xbbb-v-2": { childIds: [], fetchedAt: 1 },
        },
        strictKeys: ["0xaaa-v-1"],
        strictPrefixes: ["0xbbb-v-"],
      }),
    ).toEqual({});
  });

  it("adds placeholder nodes and merges reachable ids", () => {
    const nodes = addPlaceholderNodes({}, ["0xaaa-v-1"]);
    expect(nodes["0xaaa-v-1"]).toMatchObject({
      personHash: "0xaaa",
      versionIndex: 1,
    });
    expect(mergeReachableNodeIds(["0xaaa-v-1"], ["0xaaa-v-1", "0xbbb-v-2"])).toEqual([
      "0xaaa-v-1",
      "0xbbb-v-2",
    ]);
  });

  it("zeros fetched timestamps from version detail keys", () => {
    const out = zeroVersionDetailFetchTimes(
      {
        "0xaaa-v-1": {
          personHash: "0xaaa",
          versionIndex: 1,
          id: "0xaaa-v-1",
          versionDetailsFetchedAt: 123,
        },
      },
      ["vd:0xaaa:1"],
    );

    expect(out["0xaaa-v-1"]?.versionDetailsFetchedAt).toBe(0);
  });
});
