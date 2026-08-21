import { describe, expect, it, vi } from "vitest";
import { QueryCache } from "../../../shared/cache/QueryCache";
import { createPersonReadGateway } from "./personReadGateway";

describe("personReadGateway", () => {
  it("caches version details and triggers cache hooks", async () => {
    const contract = {
      getVersionDetails: vi.fn(async () => [
        {
          personHash: "0xabc",
          fatherHash: "0xfather",
          motherHash: "0xmother",
          versionIndex: 2,
          fatherVersionIndex: 1,
          motherVersionIndex: 2,
          versionCommitment: "0xcommitment",
          addedBy: "0xadder",
          timestamp: 123,
        },
        {
          pointer: "0x00000000000000000000000000000000000000cc",
          payloadHash: "0xpayload",
          payloadLength: 512,
        },
        7,
        42n,
      ]),
    };
    const cache = new QueryCache();
    const gateway = createPersonReadGateway(contract, cache);
    const onCacheHit = vi.fn();
    const onCacheMiss = vi.fn();
    const onFetched = vi.fn();

    const first = await gateway.getVersionDetails("0xabc", 2, {
      ttlMs: 60_000,
      onCacheHit,
      onCacheMiss,
      onFetched,
    });

    const second = await gateway.getVersionDetails("0xabc", 2, {
      ttlMs: 60_000,
      onCacheHit,
      onCacheMiss,
      onFetched,
    });

    expect(first).toEqual({
      version: {
        personHash: "0xabc",
        fatherHash: "0xfather",
        motherHash: "0xmother",
        versionIndex: "2",
        fatherVersionIndex: "1",
        motherVersionIndex: "2",
        versionCommitment: "0xcommitment",
        addedBy: "0xadder",
        timestamp: 123,
      },
      metadata: {
        pointer: "0x00000000000000000000000000000000000000cc",
        payloadHash: "0xpayload",
        payloadLength: 512,
      },
      endorsementCount: 7,
      tokenId: "42",
    });
    expect(second).toEqual(first);
    expect(contract.getVersionDetails).toHaveBeenCalledTimes(1);
    expect(onCacheMiss).toHaveBeenCalledTimes(1);
    expect(onFetched).toHaveBeenCalledTimes(1);
    expect(onCacheHit).toHaveBeenCalledTimes(1);
  });

  it("deduplicates inflight nft detail requests", async () => {
    let resolveRequest: ((value: any) => void) | undefined;
    const contract = {
      getNFTDetails: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      ),
    };
    const gateway = createPersonReadGateway(contract, new QueryCache());

    const p1 = gateway.getNFTDetails("42", { ttlMs: 60_000 });
    const p2 = gateway.getNFTDetails("42", { ttlMs: 60_000 });

    expect(contract.getNFTDetails).toHaveBeenCalledTimes(1);

    resolveRequest?.([
      "0xabc",
      2,
      {
        fatherHash: "0xfather",
        versionCommitment: "0xcommitment",
      },
      {
        pointer: "0x00000000000000000000000000000000000000cc",
        payloadHash: "0xpayload",
        payloadLength: 512,
      },
      {
        basicInfo: { gender: 2, birthYear: 1990, birthMonth: 5, birthDay: 10, isBirthBC: false },
        supplementInfo: { fullName: "Alice", birthPlace: "HK", story: "hello" },
      },
      9,
      "ipfs://token",
    ]);

    const [first, second] = await Promise.all([p1, p2]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      personHash: "0xabc",
      versionIndex: 2,
      version: {
        fatherHash: "0xfather",
        versionCommitment: "0xcommitment",
      },
      metadata: {
        pointer: "0x00000000000000000000000000000000000000cc",
        payloadHash: "0xpayload",
        payloadLength: 512,
      },
      core: {
        fullName: "Alice",
        gender: 2,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 10,
        birthPlace: "HK",
        nftPublicStory: "hello",
      },
      endorsementCount: 9,
      nftTokenURI: "ipfs://token",
    });
  });

  it("caches story metadata and parses chunk tuples", async () => {
    const contract = {
      getStoryMetadata: vi.fn(async () => ({
        totalChunks: 2,
        totalLength: 11,
        isSealed: true,
        lastUpdateTime: 123,
        fullStoryHash: "0xhash",
      })),
      listStoryChunks: vi.fn(async () => [
        [
          [0, "0x1", "hello ", 11, "0x00000000000000000000000000000000000000aa", 0, ""],
          [1, "0x2", "world", 12, "0x00000000000000000000000000000000000000aa", 1, "cid://a"],
        ],
      ]),
    };
    const cache = new QueryCache();
    const gateway = createPersonReadGateway(contract, cache);

    const metadata1 = await gateway.getStoryMetadata("42", { ttlMs: 60_000 });
    const metadata2 = await gateway.getStoryMetadata("42", { ttlMs: 60_000 });
    const chunks = await gateway.getStoryChunks("42", 0, 10);

    expect(contract.getStoryMetadata).toHaveBeenCalledTimes(1);
    expect(metadata2).toEqual(metadata1);
    expect(metadata1).toEqual({
      totalChunks: 2,
      totalLength: 11,
      isSealed: true,
      lastUpdateTime: 123,
      fullStoryHash: "0xhash",
    });
    expect(chunks).toEqual([
      {
        chunkIndex: 0,
        chunkHash: "0x1",
        content: "hello ",
        timestamp: 11,
        editor: "0x00000000000000000000000000000000000000aa",
        chunkType: 0,
        attachmentCID: "",
      },
      {
        chunkIndex: 1,
        chunkHash: "0x2",
        content: "world",
        timestamp: 12,
        editor: "0x00000000000000000000000000000000000000aa",
        chunkType: 1,
        attachmentCID: "cid://a",
      },
    ]);
  });

  it("parses endorsement, token URI, and story chunk page listings", async () => {
    const contract = {
      listVersionEndorsements: vi.fn(async () => [[1n, 2n], [3n, 5n], [10n, 11n], 7n, true, 2n]),
      listTokenURIHistory: vi.fn(async () => [["ipfs://a", "ipfs://b"], 4n, true, 2n]),
      listStoryChunks: vi.fn(async () => ({
        chunks: [[0, "0x1", "hello", 1, "0x00000000000000000000000000000000000000aa", 0, ""]],
        totalChunks: 3n,
        hasMore: true,
        nextOffset: 1n,
      })),
    };
    const gateway = createPersonReadGateway(contract, new QueryCache());

    await expect(gateway.listVersionEndorsements("0xabc", 0, 2)).resolves.toEqual({
      versionIndices: [1, 2],
      endorsementCounts: [3, 5],
      tokenIds: [10, 11],
      totalVersions: 7,
      hasMore: true,
      nextOffset: 2,
    });
    await expect(gateway.listTokenUriHistory("42", 0, 2)).resolves.toEqual({
      uris: ["ipfs://a", "ipfs://b"],
      totalCount: 4,
      hasMore: true,
      nextOffset: 2,
    });
    await expect(gateway.listStoryChunksPage("42", 0, 1)).resolves.toEqual({
      chunks: [
        {
          chunkIndex: 0,
          chunkHash: "0x1",
          content: "hello",
          timestamp: 1,
          editor: "0x00000000000000000000000000000000000000aa",
          chunkType: 0,
          attachmentCID: "",
        },
      ],
      totalChunks: 3,
      hasMore: true,
      nextOffset: 1,
    });
  });
});
