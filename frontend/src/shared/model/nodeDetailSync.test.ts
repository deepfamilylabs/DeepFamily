import { describe, expect, it } from "vitest";
import type { StoryDataResult } from "./storyData";
import {
  applyNodeDetailNftDetails,
  applyNodeDetailVersionDetails,
  resolveNodeDetailTokenId,
  resolveSelectedNodeData,
} from "./nodeDetailSync";

describe("nodeDetailSync", () => {
  it("resolves selected node data by person/version key", () => {
    const nodesData = {
      "0xabc-v-2": {
        personHash: "0xabc",
        versionIndex: 2,
        id: "0xabc-v-2",
        fullName: "Alice",
      },
    };

    expect(
      resolveSelectedNodeData(nodesData, {
        personHash: "0xabc",
        versionIndex: 2,
      })?.fullName,
    ).toBe("Alice");
    expect(resolveSelectedNodeData(nodesData, null)).toBeNull();
  });

  it("prefers fetched token id and filters zero token ids", () => {
    expect(resolveNodeDetailTokenId("42", "7")).toBe("42");
    expect(resolveNodeDetailTokenId(undefined, "7")).toBe("7");
    expect(resolveNodeDetailTokenId("0", "7")).toBeNull();
    expect(resolveNodeDetailTokenId(undefined, undefined)).toBeNull();
  });

  it("applies version details into node state", () => {
    const out = applyNodeDetailVersionDetails({
      nodesData: {
        "0xabc-v-2": {
          personHash: "0xabc",
          versionIndex: 2,
          id: "0xabc-v-2",
          tag: "existing",
        },
      },
      selected: { personHash: "0xabc", versionIndex: 2 },
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
        endorsementCount: 8,
        tokenId: "42",
      },
      fetchedAt: 999,
    });

    expect(out["0xabc-v-2"]).toMatchObject({
      tokenId: "42",
      endorsementCount: 8,
      fatherHash: "0xfather",
      motherHash: "0xmother",
      versionDetailsFetchedAt: 999,
    });
    expect(out["0xabc-v-2"]).not.toHaveProperty("tag");
  });

  it("removes unlocked plaintext from the final detail state when version anchors change", () => {
    const id = "0xabc-v-2";
    const out = applyNodeDetailVersionDetails({
      nodesData: {
        [id]: {
          personHash: "0xabc",
          versionIndex: 2,
          id,
          tokenId: "0",
          versionCommitment: "old-commitment",
          metadataPointer: "0x00000000000000000000000000000000000000aa",
          metadataPayloadHash: "0xold-payload",
          metadataPayloadLength: 128,
          metadataUnlockValidated: true,
          metadataProtocolGeneration: "df-onchain-biography-v1",
          tag: "private tag",
          biography: "private biography",
          fullName: "Private name",
        },
      },
      selected: { personHash: "0xabc", versionIndex: 2 },
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
      fetchedAt: 1000,
    });

    expect(out[id]).toMatchObject({
      metadataUnlockValidated: false,
      versionCommitment: "new-commitment",
      metadataPayloadHash: "0xnew-payload",
    });
    expect(out[id]).not.toHaveProperty("tag");
    expect(out[id]).not.toHaveProperty("biography");
    expect(out[id]).not.toHaveProperty("fullName");
  });

  it("applies nft and story details onto an existing node", () => {
    const storyData: StoryDataResult = {
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
      fullStory: "hello",
      integrity: {
        missing: [],
        lengthMatch: true,
        hashMatch: true,
        computedLength: 5,
        computedHash: "0xstory",
      },
      metadata: {
        totalChunks: 1,
        totalLength: 5,
        isSealed: true,
        lastUpdateTime: 55,
        fullStoryHash: "0xstory",
      },
      loading: false,
      fetchedAt: 777,
    };

    const out = applyNodeDetailNftDetails({
      nodesData: {
        "0xabc-v-2": {
          personHash: "0xabc",
          versionIndex: 2,
          id: "0xabc-v-2",
          tokenId: "42",
          tag: "existing",
        },
      },
      selected: { personHash: "0xabc", versionIndex: 2 },
      tokenId: "42",
      nftDetails: {
        personHash: "0xabc",
        versionIndex: 2,
        version: {
          fatherHash: "0xfather",
          versionCommitment: "123",
        },
        metadata: {
          pointer: "0x00000000000000000000000000000000000000aa",
          payloadHash: "0xpayload",
          payloadLength: 128,
        },
        core: {
          fullName: "Alice",
          gender: 2,
          birthPlace: "HK",
        },
        endorsementCount: 9,
        nftTokenURI: "ipfs://token",
      },
      storyData,
    });

    expect(out["0xabc-v-2"]).toMatchObject({
      tokenId: "42",
      fullName: "Alice",
      gender: 2,
      birthPlace: "HK",
      fatherHash: "0xfather",
      metadataPointer: "0x00000000000000000000000000000000000000aa",
      metadataPayloadHash: "0xpayload",
      metadataPayloadLength: 128,
      endorsementCount: 9,
      nftTokenURI: "ipfs://token",
      storyFetchedAt: 777,
    });
    expect(out["0xabc-v-2"]?.storyMetadata).toEqual(storyData.metadata);
    expect(out["0xabc-v-2"]?.storyChunks).toEqual(storyData.chunks);
  });

  it("drops decrypted metadata when NFT details carry different authoritative anchors", () => {
    const id = "0xabc-v-2";
    const out = applyNodeDetailNftDetails({
      nodesData: {
        [id]: {
          personHash: "0xabc",
          versionIndex: 2,
          id,
          tokenId: "42",
          versionCommitment: "old-commitment",
          metadataPointer: "0x00000000000000000000000000000000000000aa",
          metadataPayloadHash: "0xold-payload",
          metadataPayloadLength: 128,
          metadataUnlockValidated: true,
          metadataProtocolGeneration: "df-onchain-biography-v1",
          metadataFormatVersion: 1,
          identitySuiteId: 1,
          fullName: "Old public name",
          tag: "private tag",
          biography: "private biography",
          metadataPerson: {
            fullName: "Old public name",
            gender: 2,
            birthYear: 1980,
            birthMonth: 1,
            birthDay: 2,
            isBirthBC: false,
            personHash: "0xabc",
          },
          metadataParents: { father: null, mother: null },
        },
      },
      selected: { personHash: "0xabc", versionIndex: 2 },
      tokenId: "42",
      nftDetails: {
        personHash: "0xabc",
        versionIndex: 2,
        version: { versionCommitment: "new-commitment" },
        metadata: {
          pointer: "0x00000000000000000000000000000000000000bb",
          payloadHash: "0xnew-payload",
          payloadLength: 256,
        },
        core: { fullName: "New public name", gender: 1 },
      },
      storyData: null,
    });

    expect(out[id]).toMatchObject({
      fullName: "New public name",
      gender: 1,
      versionCommitment: "new-commitment",
      metadataPayloadHash: "0xnew-payload",
      metadataUnlockValidated: false,
    });
    for (const key of [
      "tag",
      "biography",
      "metadataPerson",
      "metadataParents",
      "metadataProtocolGeneration",
      "metadataFormatVersion",
      "identitySuiteId",
    ]) {
      expect(out[id]).not.toHaveProperty(key);
    }
  });

  it("does not create a node when nft details arrive before version bootstrap", () => {
    const out = applyNodeDetailNftDetails({
      nodesData: {},
      selected: { personHash: "0xabc", versionIndex: 2 },
      tokenId: "42",
      nftDetails: {
        personHash: "0xabc",
        versionIndex: 2,
        version: {},
        metadata: {},
        core: { fullName: "Alice" },
      },
      storyData: null,
    });

    expect(out).toEqual({});
  });
});
