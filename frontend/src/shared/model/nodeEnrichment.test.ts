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
  it("builds version-details patch with encrypted metadata anchors", () => {
    const patch = buildVersionDetailsPatch({
      id: "0xabc-v-2",
      original: { h: "0xabc", v: 2 },
      parsed: {
        version: {
          fatherHash: "0xfather",
          motherHash: "0xmother",
          fatherVersionIndex: "1",
          motherVersionIndex: "1",
          versionCommitment: "123",
          addedBy: "0xadder",
          timestamp: 123,
        },
        metadata: {
          pointer: "0x00000000000000000000000000000000000000aa",
          payloadHash: "0xpayload",
          payloadLength: 128,
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

    expect(patch.metadataPayloadHash).toBe("0xpayload");
    expect(patch.versionCommitment).toBe("123");
    expect(patch.endorsementCount).toBe(9);
    expect(patch.tokenId).toBe("42");
    expect(patch.versionDetailsFetchedAt).toBe(999);
  });

  it("removes every private decrypted field when authoritative anchors change", () => {
    const current = {
      personHash: "0xabc",
      versionIndex: 2,
      id: "0xabc-v-2",
      versionCommitment: "old-commitment",
      metadataPointer: "0x00000000000000000000000000000000000000aa",
      metadataPayloadHash: "0xold-payload",
      metadataPayloadLength: 128,
      metadataUnlockValidated: true,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      tag: "private tag",
      biography: "private biography",
      fullName: "Private Name",
      gender: 2,
      birthYear: 1980,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
      metadataPerson: {
        fullName: "Private Name",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash: "0xabc",
      },
      metadataParents: { father: null, mother: null },
      tokenId: "0",
    };
    const patch = buildVersionDetailsPatch({
      id: "0xabc-v-2",
      original: { h: "0xabc", v: 2 },
      parsed: {
        version: {
          versionCommitment: "new-commitment",
          fatherHash: "0xfather",
          motherHash: "0xmother",
        },
        metadata: {
          pointer: "0x00000000000000000000000000000000000000bb",
          payloadHash: "0xnew-payload",
          payloadLength: 256,
        },
        endorsementCount: 1,
        tokenId: "0",
      },
      current,
      versionDetailsFetchedAt: 1000,
    });

    expect(patch.metadataUnlockValidated).toBe(false);
    const persistedNode = structuredClone(
      applyNodeEnrichmentPatches({ [current.id]: current }, [{ id: current.id, patch }])[
        current.id
      ],
    );
    expect(persistedNode).toMatchObject({
      metadataUnlockValidated: false,
      versionCommitment: "new-commitment",
      metadataPointer: "0x00000000000000000000000000000000000000bb",
      metadataPayloadHash: "0xnew-payload",
      metadataPayloadLength: 256,
    });
    for (const key of [
      "tag",
      "biography",
      "metadataPerson",
      "metadataParents",
      "metadataProtocolGeneration",
      "metadataFormatVersion",
      "identitySuiteId",
      "fullName",
      "gender",
      "birthYear",
      "birthMonth",
      "birthDay",
      "isBirthBC",
    ]) {
      expect(patch).not.toHaveProperty(key);
      expect(persistedNode).not.toHaveProperty(key);
    }
  });

  it("physically removes stale plaintext even when the invalid marker was already false", () => {
    const id = "0xabc-v-2";
    const stale = {
      personHash: "0xabc",
      versionIndex: 2,
      id,
      tokenId: "0",
      versionCommitment: "old-commitment",
      metadataPointer: "0x00000000000000000000000000000000000000aa",
      metadataPayloadHash: "0xold-payload",
      metadataPayloadLength: 128,
      metadataUnlockValidated: false,
      metadataProtocolGeneration: "df-onchain-biography-v1",
      metadataFormatVersion: 1,
      identitySuiteId: 1,
      metadataPerson: {
        fullName: "Stale private name",
        gender: 2,
        birthYear: 1980,
        birthMonth: 1,
        birthDay: 2,
        isBirthBC: false,
        personHash: "0xabc",
      },
      metadataParents: { father: null, mother: null },
      fullName: "Stale private name",
      tag: "stale private tag",
      biography: "stale private biography",
    };

    const patch = buildVersionDetailsPatch({
      id,
      original: { h: "0xabc", v: 2 },
      current: stale,
      parsed: {
        version: { versionCommitment: "new-commitment" },
        metadata: {
          pointer: "0x00000000000000000000000000000000000000bb",
          payloadHash: "0xnew-payload",
          payloadLength: 256,
        },
        endorsementCount: 1,
        tokenId: "0",
      },
      versionDetailsFetchedAt: 1000,
    });
    const patched = applyNodeEnrichmentPatches({ [id]: stale }, [{ id, patch }])[id];

    expect(patched.metadataUnlockValidated).toBe(false);
    expect(patched.versionCommitment).toBe("new-commitment");
    expect(patched.metadataPayloadHash).toBe("0xnew-payload");
    for (const key of [
      "tag",
      "biography",
      "metadataPerson",
      "metadataParents",
      "metadataProtocolGeneration",
      "metadataFormatVersion",
      "identitySuiteId",
      "fullName",
    ]) {
      expect(patched).not.toHaveProperty(key);
    }
  });

  it("clears an unmarked unlock footprint when an authoritative anchor changes", () => {
    const id = "0xabc-v-2";
    const patched = applyNodeEnrichmentPatches(
      {
        [id]: {
          personHash: "0xabc",
          versionIndex: 2,
          id,
          tokenId: "0",
          versionCommitment: "old-commitment",
          tag: "orphaned private tag",
          biography: "orphaned private biography",
        },
      },
      [{ id, patch: { versionCommitment: "new-commitment" } }],
    )[id];

    expect(patched.versionCommitment).toBe("new-commitment");
    expect(patched.metadataUnlockValidated).toBe(false);
    expect(patched.tag).toBeUndefined();
    expect(patched.biography).toBeUndefined();
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
        metadata: {},
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
    // NFT enrichment is a selective patch. Applying it must leave private,
    // locally unlocked metadata untouched instead of copying a stale snapshot.
    expect(patch).not.toHaveProperty("tag");
    expect(patch.fullName).toBe("Alice");
    expect(patch.tokenId).toBe("42");
  });
});

describe("nodeEnrichment fetchNodeEnrichmentBatch", () => {
  it("fetches version details, then nft details and story metadata when needed", async () => {
    const api = {
      getVersionDetails: vi.fn(async () => ({
        version: { versionCommitment: "123" },
        metadata: {},
        endorsementCount: 3,
        tokenId: "88",
      })),
      getNFTDetails: vi.fn(async () => ({
        personHash: "0xabc",
        versionIndex: 2,
        version: {},
        metadata: {},
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
          tag: "private-local-tag",
          biography: "private local biography",
          metadataUnlockValidated: true,
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
          tag: "private-local-tag",
          biography: "private local biography",
          metadataUnlockValidated: true,
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
    expect(withPatches["0xaaa-v-1"]).toMatchObject({
      fullName: "Alice",
      id: "0xaaa-v-1",
      tag: "private-local-tag",
      biography: "private local biography",
      metadataUnlockValidated: true,
    });
  });
});
