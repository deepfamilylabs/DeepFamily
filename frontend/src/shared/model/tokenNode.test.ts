import { describe, expect, it } from "vitest";
import {
  applyOwnerToTokenNode,
  backfillPersistedTokenNode,
  buildNodeFromNftDetails,
  getOwnerFromTokenNode,
} from "./tokenNode";

describe("tokenNode", () => {
  it("builds a node from nft details", () => {
    const node = buildNodeFromNftDetails("42", {
      personHash: "0xabc",
      versionIndex: 2,
      version: {
        fatherHash: "0xfather",
      },
      metadata: {
        pointer: "0x00000000000000000000000000000000000000aa",
        payloadHash: "0xpayload",
        payloadLength: 128,
      },
      core: {
        fullName: "Alice",
        gender: 2,
      },
      endorsementCount: 7,
      nftTokenURI: "ipfs://token",
    });

    expect(node).toMatchObject({
      id: "0xabc-v-2",
      tokenId: "42",
      fullName: "Alice",
      fatherHash: "0xfather",
      endorsementCount: 7,
      nftTokenURI: "ipfs://token",
    });
  });

  it("backfills persisted entries and updates owner by token id", () => {
    const backfilled = backfillPersistedTokenNode(
      {},
      [
        "0xabc-v-2",
        {
          personHash: "0xabc",
          versionIndex: 2,
          id: "0xabc-v-2",
          tokenId: "42",
        },
      ],
    );

    expect(backfilled["0xabc-v-2"]?.tokenId).toBe("42");
    expect(getOwnerFromTokenNode(backfilled, "42")).toBeNull();

    const withOwner = applyOwnerToTokenNode(backfilled, "42", "0xowner");
    expect(withOwner["0xabc-v-2"]?.owner).toBe("0xowner");
    expect(getOwnerFromTokenNode(withOwner, "42")).toBe("0xowner");
  });
});
