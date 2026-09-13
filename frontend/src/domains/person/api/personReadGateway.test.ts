import { ethers } from "ethers";
import {
  encodeStoryRecord,
  STORY_BIOGRAPHY_SCHEMA_ID,
  STORY_ENVELOPE_SCHEMA_ID,
} from "@deepfamily/protocol-core";
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
          segmentCount: 1,
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
        segmentCount: 1,
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
      listStoryRecords: vi.fn().mockResolvedValue({ records: [] }),
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
        segmentCount: 1,
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
        segmentCount: 1,
        payloadLength: 512,
      },
      core: {
        fullName: "Alice",
        gender: 2,
        birthYear: 1990,
        birthMonth: 5,
        birthDay: 10,
        birthPlace: "HK",
        nftPublicStory: undefined,
      },
      endorsementCount: 9,
      nftTokenURI: "ipfs://token",
    });
  });

  it("caches StoryState and verifies canonical records from bytecode", async () => {
    const bytes = encodeStoryRecord({ content: "hello 🙂", recordType: 1, attachmentCID: "" });
    const pointer = "0x0000000000000000000000000000000000000011";
    const archive = "0x0000000000000000000000000000000000000022";
    const author = "0x0000000000000000000000000000000000000033";
    const ref = {
      blob: {
        pointer,
        payloadHash: ethers.keccak256(bytes),
        payloadLength: bytes.length,
        segmentCount: 1,
      },
      schemaId: STORY_ENVELOPE_SCHEMA_ID,
      author,
      timestamp: 12n,
    };
    const getCode = vi.fn(async () => ethers.hexlify(ethers.concat(["0x00", bytes])));
    const contract = {
      runner: { getNetwork: async () => ({ chainId: 31337n }), getCode },
      ARCHIVE: async () => archive,
      getStoryState: vi.fn(async () => ({
        totalRecords: 1n,
        totalPayloadLength: BigInt(bytes.length),
        recordsHead: ethers.ZeroHash,
        lastUpdateTime: 12n,
        isSealed: false,
      })),
      getStoryRecordRef: vi.fn(async () => ref),
      listStoryRecords: vi.fn(async () => ({
        records: [ref],
        totalRecords: 1n,
        hasMore: false,
        nextOffset: 1n,
      })),
    };
    const gateway = createPersonReadGateway(contract, new QueryCache());
    const one = await gateway.getStoryMetadata("42", { ttlMs: 60000 });
    const two = await gateway.getStoryMetadata("42", { ttlMs: 60000 });
    expect(one).toEqual(two);
    expect(one.totalRecords).toBe(1);
    expect(one.totalPayloadLength).toBe(bytes.length);
    expect(contract.getStoryState).toHaveBeenCalledTimes(1);
    expect(contract.getStoryRecordRef).toHaveBeenCalledWith("42", 0);
    expect(one.biographyPayloadLength).toBeUndefined();
    const records = await gateway.getStoryRecords("42", 0, 10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      content: "hello 🙂",
      recordIndex: 0,
      recordType: 1,
      schemaId: STORY_ENVELOPE_SCHEMA_ID,
      unsupportedSchema: false,
      rawPayload: ethers.hexlify(bytes),
    });
    expect(getCode).toHaveBeenCalledWith(pointer, "latest");
  });

  it("identifies the biography in metadata without downloading or decoding its payload", async () => {
    const contract = {
      getStoryState: vi.fn().mockResolvedValue({
        totalRecords: 2n,
        totalPayloadLength: 300n,
        recordsHead: ethers.id("head"),
        lastUpdateTime: 12n,
        isSealed: false,
      }),
      getStoryRecordRef: vi.fn().mockResolvedValue({
        schemaId: STORY_BIOGRAPHY_SCHEMA_ID,
        blob: { payloadLength: 200n },
      }),
    };
    const gateway = createPersonReadGateway(contract, new QueryCache());
    const metadata = await gateway.getStoryMetadata("42");
    expect(metadata).toMatchObject({
      totalRecords: 2,
      totalPayloadLength: 300,
      biographyPayloadLength: 200,
    });
    contract.getStoryState.mockResolvedValue({
      totalRecords: 0n,
      totalPayloadLength: 0n,
      recordsHead: ethers.ZeroHash,
      lastUpdateTime: 0n,
      isSealed: false,
    });
    expect((await gateway.getStoryMetadata("43")).biographyPayloadLength).toBeUndefined();
    expect(contract.getStoryRecordRef).toHaveBeenCalledTimes(1);
  });

  it("parses endorsement/URI pages and preserves verified unknown Story schemas", async () => {
    const payload = "0x1234";
    const schemaId = ethers.id("future schema");
    const ref = {
      blob: {
        pointer: "0x0000000000000000000000000000000000000011",
        payloadHash: ethers.keccak256(payload),
        payloadLength: 2n,
        segmentCount: 1n,
      },
      schemaId,
      author: "0x0000000000000000000000000000000000000033",
      timestamp: 12n,
    };
    const contract = {
      runner: { getNetwork: async () => ({ chainId: 31337n }), getCode: async () => "0x001234" },
      ARCHIVE: async () => "0x0000000000000000000000000000000000000022",
      listVersionEndorsements: vi.fn(async () => [[1n, 2n], [3n, 5n], [10n, 11n], 7n, true, 2n]),
      listTokenURIHistory: vi.fn(async () => [["ipfs://a", "ipfs://b"], 4n, true, 2n]),
      listStoryRecords: vi.fn(async () => ({
        records: [ref],
        totalRecords: 3n,
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
    const page = await gateway.listStoryRecordsPage("42", 0, 1);
    expect(page).toMatchObject({
      totalRecords: 3,
      hasMore: true,
      nextOffset: 1,
      records: [
        { recordIndex: 0, content: "", rawPayload: payload, schemaId, unsupportedSchema: true },
      ],
    });
  });
});
