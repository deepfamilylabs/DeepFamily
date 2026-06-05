import { describe, expect, it, vi } from "vitest";
import { createTreeNodeDataAccess } from "./treeNodeDataAccess";
import type { NodeData } from "../../../shared/model";

describe("treeNodeDataAccess", () => {
  it("uses the main NFT contract for ownerOf lookups", async () => {
    let nodesData: Record<string, NodeData> = {
      "0xabc-v-1": {
        id: "0xabc-v-1",
        personHash: "0xabc",
        versionIndex: 1,
        tokenId: "7",
      },
    };
    const setNodesData = vi.fn(
      (updater: (prev: Record<string, NodeData>) => Record<string, NodeData>) => {
        nodesData = updater(nodesData);
      },
    );
    const readerContract = {
      ownerOf: vi.fn(async () => "0xreader"),
    };
    const nftContract = {
      ownerOf: vi.fn(async () => "0xowner"),
    };

    const access = createTreeNodeDataAccess({
      api: null,
      contract: readerContract,
      nftContract,
      contractAddress: "0xcontract",
      provider: {},
      nodesDataRef: {
        get current() {
          return nodesData;
        },
      },
      setNodesData,
      storageNS: "test",
      nftDetailsTtlMs: 60_000,
      storyTtlMs: 60_000,
      storyPageLimit: 10,
      storyRevalidateRef: { current: new Set() },
    });

    await expect(access.getOwnerOf("7")).resolves.toBe("0xowner");

    expect(nftContract.ownerOf).toHaveBeenCalledWith("7");
    expect(readerContract.ownerOf).not.toHaveBeenCalled();
    expect(nodesData["0xabc-v-1"]?.owner).toBe("0xowner");
  });
});
