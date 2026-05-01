import { describe, expect, it, vi } from "vitest";
import {
  applyNodeDataBackfills,
  applyNodeEnrichmentPatches,
  buildNftDetailsPatch,
  buildVersionDetailsPatch,
  fetchNodeEnrichmentBatch,
  hasVersionDetailFields,
  isVersionDetailsFresh,
  planNodeEnrichmentSlice,
} from "./nodeEnrichment";

describe("nodeEnrichment patch builders", () => {
  it("builds version-details patch with current tag fallback", () => {
    const patch = buildVersionDetailsPatch({
      id: "0xabc-v-2",
      original: { h: "0xabc", v: 2 },
      parsed: {
        version: {
          fatherHash: "0xfather",
          motherHash: "0xmother",
          fatherVersionIndex: 1,
          motherVersionIndex: 1,
          addedBy: "0xadder",
          timestamp: 123,
          metadataCID: "cid",
        },
        endorsementCount: 9,
        tokenId: "42",
      },
      current: {
        personHash: "0xabc",
        versionIndex: 2,
        id: "0xabc-v-2",
        tag: "existing",
      },
      versionDetailsFetchedAt: 999,
    });

    expect(patch.tag).toBe("existing");
    expect(patch.endorsementCount).toBe(9);
    expect(patch.tokenId).toBe("42");
    expect(patch.versionDetailsFetchedAt).toBe(999);
  });

  it("builds nft patch preserving existing fields when nft details omit them", () => {
    const patch = buildNftDetailsPatch({
      current: {
        personHash: "0xabc",
        versionIndex: 2,
        id: "0xabc-v-2",
        fatherHash: "0xfather",
        tag: "existing",
      },
      tokenId: "42",
      nftRet: {
        personHash: "0xabc",
        versionIndex: 2,
        version: {},
        core: { fullName: "Alice" },
        endorsementCount: 7,
        nftTokenURI: "ipfs://token",
      },
      storyMetadata: {
        totalChunks: 0,
        totalLength: 0,
        isSealed: false,
        lastUpdateTime: 0,
        fullStoryHash: "",
      },
    });

    expect(patch.fatherHash).toBe("0xfather");
    expect(patch.tag).toBe("existing");
    expect(patch.fullName).toBe("Alice");
    expect(patch.tokenId).toBe("42");
  });
});

describe("nodeEnrichment fetchNodeEnrichmentBatch", () => {
  it("fetches version details, then nft details and story metadata when needed", async () => {
    const api = {
      getVersionDetails: vi.fn(async () => ({
        version: { tag: "v2" },
        endorsementCount: 3,
        tokenId: "88",
      })),
      getNFTDetails: vi.fn(async () => ({
        personHash: "0xabc",
        versionIndex: 2,
        version: {},
        core: { fullName: "Alice" },
        endorsementCount: 4,
        nftTokenURI: "ipfs://token",
      })),
    };

    const readStoryMetadata = vi.fn(async () => ({
      totalChunks: 2,
      totalLength: 10,
      isSealed: true,
      lastUpdateTime: 1,
      fullStoryHash: "0xhash",
    }));

    const result = await fetchNodeEnrichmentBatch({
      targets: [{ h: "0xabc", v: 2 }],
      api: api as any,
      versionDetailsTtlMs: 1000,
      nftDetailsTtlMs: 2000,
      getVersionDetailsFetchedAt: () => 777,
      getCurrentNode: () => ({ personHash: "0xabc", versionIndex: 2, id: "0xabc-v-2" }),
      readStoryMetadata,
    });

    expect(api.getVersionDetails).toHaveBeenCalledTimes(1);
    expect(api.getNFTDetails).toHaveBeenCalledTimes(1);
    expect(readStoryMetadata).toHaveBeenCalledWith("88");
    expect(result.nftErrors).toEqual([]);
    expect(result.patches).toHaveLength(2);
    expect(result.patches[0]).toMatchObject({
      id: "0xabc-v-2",
      patch: { tokenId: "88", endorsementCount: 3, versionDetailsFetchedAt: 777 },
    });
    expect(result.patches[1]).toMatchObject({
      id: "0xabc-v-2",
      patch: {
        fullName: "Alice",
        tokenId: "88",
        storyMetadata: { totalChunks: 2, isSealed: true },
      },
    });
  });

  it("skips nft enrichment when node already has fullName", async () => {
    const api = {
      getVersionDetails: vi.fn(async () => ({
        version: {},
        endorsementCount: 1,
        tokenId: "9",
      })),
      getNFTDetails: vi.fn(),
    };

    const result = await fetchNodeEnrichmentBatch({
      targets: [{ h: "0xabc", v: 1 }],
      api: api as any,
      versionDetailsTtlMs: 1000,
      nftDetailsTtlMs: 2000,
      getVersionDetailsFetchedAt: () => 123,
      getCurrentNode: () => ({
        personHash: "0xabc",
        versionIndex: 1,
        id: "0xabc-v-1",
        fullName: "Existing",
      }),
      readStoryMetadata: vi.fn(),
    });

    expect(api.getNFTDetails).not.toHaveBeenCalled();
    expect(result.patches).toHaveLength(1);
  });

  it("collects nft enrichment errors without aborting the batch", async () => {
    const api = {
      getVersionDetails: vi
        .fn()
        .mockResolvedValueOnce({ version: {}, endorsementCount: 1, tokenId: "9" })
        .mockResolvedValueOnce({ version: {}, endorsementCount: 2, tokenId: "10" }),
      getNFTDetails: vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({
          personHash: "0xbbb",
          versionIndex: 2,
          version: {},
          core: { fullName: "Bob" },
          endorsementCount: 2,
          nftTokenURI: "ipfs://token",
        }),
    };

    const result = await fetchNodeEnrichmentBatch({
      targets: [
        { h: "0xaaa", v: 1 },
        { h: "0xbbb", v: 2 },
      ],
      api: api as any,
      versionDetailsTtlMs: 1000,
      nftDetailsTtlMs: 2000,
      getVersionDetailsFetchedAt: () => 123,
      getCurrentNode: (id) => ({
        personHash: id.includes("aaa") ? "0xaaa" : "0xbbb",
        versionIndex: id.includes("aaa") ? 1 : 2,
        id,
      }),
      readStoryMetadata: vi.fn(async () => ({
        totalChunks: 0,
        totalLength: 0,
        isSealed: false,
        lastUpdateTime: 0,
        fullStoryHash: "",
      })),
    });

    expect(result.nftErrors).toHaveLength(1);
    expect(result.nftErrors[0]?.id).toBe("0xaaa-v-1");
    expect(result.patches).toHaveLength(3);
  });
});

describe("nodeEnrichment planning helpers", () => {
  it("checks version detail presence and freshness", () => {
    expect(hasVersionDetailFields(undefined)).toBe(false);
    expect(
      hasVersionDetailFields({
        personHash: "0xabc",
        versionIndex: 1,
        id: "0xabc-v-1",
        endorsementCount: 1,
        tokenId: "9",
      }),
    ).toBe(true);
    expect(
      isVersionDetailsFresh(
        {
          personHash: "0xabc",
          versionIndex: 1,
          id: "0xabc-v-1",
          endorsementCount: 1,
          tokenId: "9",
          versionDetailsFetchedAt: Date.now(),
        },
        60_000,
      ),
    ).toBe(true);
  });

  it("plans targets and backfills from a persisted snapshot", () => {
    const plan = planNodeEnrichmentSlice({
      slice: [
        { h: "0xaaa", v: 1 },
        { h: "0xbbb", v: 2 },
      ],
      snapshot: {
        "0xaaa-v-1": {
          personHash: "0xaaa",
          versionIndex: 1,
          id: "0xaaa-v-1",
          endorsementCount: 1,
          tokenId: "11",
          versionDetailsFetchedAt: Date.now(),
        },
      },
      currentNodes: {},
      versionDetailsTtlMs: 60_000,
    });

    expect(plan.targets).toEqual([{ h: "0xbbb", v: 2 }]);
    expect(plan.backfills["0xaaa-v-1"]?.tokenId).toBe("11");
  });

  it("applies backfills and enrichment patches without clobbering ids", () => {
    const withBackfill = applyNodeDataBackfills(
      {
        "0xaaa-v-1": {
          personHash: "0xaaa",
          versionIndex: 1,
          id: "0xaaa-v-1",
        },
      },
      {
        "0xaaa-v-1": {
          personHash: "0xaaa",
          versionIndex: 1,
          id: "0xaaa-v-1",
          endorsementCount: 2,
          tokenId: "10",
        },
      },
    );

    expect(withBackfill["0xaaa-v-1"]).toMatchObject({
      id: "0xaaa-v-1",
      endorsementCount: 2,
      tokenId: "10",
    });

    const withPatches = applyNodeEnrichmentPatches(withBackfill, [
      {
        id: "0xaaa-v-1",
        patch: { fullName: "Alice" },
      },
    ]);
    expect(withPatches["0xaaa-v-1"]).toMatchObject({ fullName: "Alice", id: "0xaaa-v-1" });
  });
});
