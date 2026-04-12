// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeDetailProvider, useNodeDetail } from "./NodeDetailProvider";
import { makeNodeId, type NodeData } from "../../../shared/model";

const mocks = vi.hoisted(() => ({
  nodesData: {} as Record<string, NodeData>,
  setNodesData: vi.fn(),
  usePersonDetails: vi.fn(),
  useNFTDetails: vi.fn(),
  useStoryData: vi.fn(),
}));

vi.mock("../../tree/context", () => ({
  useTreeGraphData: () => ({
    nodesData: mocks.nodesData,
  }),
  useTreeMutations: () => ({
    setNodesData: mocks.setNodesData,
  }),
}));

vi.mock("../queries", () => ({
  usePersonDetails: (...args: any[]) => mocks.usePersonDetails(...args),
  useNFTDetails: (...args: any[]) => mocks.useNFTDetails(...args),
  useStoryData: (...args: any[]) => mocks.useStoryData(...args),
}));

vi.mock("./NodeDetailModal", () => ({
  default: (props: any) => (
    <div data-testid="node-detail-modal" data-open={props.open ? "true" : "false"}>
      <div data-testid="fallback-hash">{props.fallback.hash}</div>
      <div data-testid="fallback-version">{String(props.fallback.versionIndex ?? "")}</div>
      <div data-testid="node-name">{props.nodeData?.fullName ?? ""}</div>
      <div data-testid="node-token">{props.nodeData?.tokenId ?? ""}</div>
      <div data-testid="loading">{props.loading ? "true" : "false"}</div>
      <div data-testid="error">{props.error ?? ""}</div>
      <button type="button" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

const emptyQuery = {
  data: null,
  loading: false,
  error: null,
  refetch: vi.fn(),
};

function Harness() {
  const nodeDetail = useNodeDetail();
  return (
    <>
      <button
        type="button"
        onClick={() => nodeDetail.openNode({ personHash: "0xperson", versionIndex: 2 })}
      >
        open
      </button>
      <div data-testid="context-open">{nodeDetail.open ? "true" : "false"}</div>
      <div data-testid="context-name">{nodeDetail.selectedNodeData?.fullName ?? ""}</div>
    </>
  );
}

describe("NodeDetailProvider", () => {
  beforeEach(() => {
    const id = makeNodeId("0xperson", 2);
    mocks.nodesData = {
      [id]: {
        id,
        personHash: "0xperson",
        versionIndex: 2,
        fullName: "Cached Ada",
        tokenId: "7",
      },
    };
    mocks.setNodesData.mockReset();
    mocks.usePersonDetails.mockReset();
    mocks.useNFTDetails.mockReset();
    mocks.useStoryData.mockReset();
    mocks.usePersonDetails.mockReturnValue(emptyQuery);
    mocks.useNFTDetails.mockReturnValue(emptyQuery);
    mocks.useStoryData.mockReturnValue(emptyQuery);
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the modal with selected node data and closes through the modal handler", async () => {
    render(
      <NodeDetailProvider>
        <Harness />
      </NodeDetailProvider>,
    );

    expect(screen.getByTestId("node-detail-modal").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("context-open").textContent).toBe("false");

    await act(async () => {
      screen.getByText("open").click();
    });

    expect(screen.getByTestId("node-detail-modal").getAttribute("data-open")).toBe("true");
    expect(screen.getByTestId("context-open").textContent).toBe("true");
    expect(screen.getByTestId("fallback-hash").textContent).toBe("0xperson");
    expect(screen.getByTestId("fallback-version").textContent).toBe("2");
    expect(screen.getByTestId("node-name").textContent).toBe("Cached Ada");
    expect(screen.getByTestId("context-name").textContent).toBe("Cached Ada");

    await act(async () => {
      screen.getByText("close").click();
    });

    expect(screen.getByTestId("node-detail-modal").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("fallback-hash").textContent).toBe("");
    expect(screen.getByTestId("context-open").textContent).toBe("false");
  });

  it("passes selected keys to queries, aggregates state, and writes fetched details back to tree data", async () => {
    mocks.usePersonDetails.mockImplementation((personHash, versionIndex) => {
      if (!personHash || !versionIndex) return emptyQuery;
      return {
        data: {
          version: {
            fatherHash: "0xfather",
            motherHash: "0xmother",
            fatherVersionIndex: 1,
            motherVersionIndex: 1,
            addedBy: "0xadder",
            timestamp: 123,
            metadataCID: "cid://meta",
          },
          endorsementCount: 8,
          tokenId: "42",
        },
        loading: true,
        error: null,
        refetch: vi.fn(),
      };
    });
    mocks.useNFTDetails.mockImplementation((tokenId) => {
      if (!tokenId) return emptyQuery;
      return {
        data: {
          personHash: "0xperson",
          versionIndex: 2,
          version: {
            metadataCID: "cid://nft-meta",
          },
          core: {
            fullName: "Fetched Ada",
            gender: 2,
            birthPlace: "London",
          },
          endorsementCount: 9,
          nftTokenURI: "ipfs://token",
        },
        loading: false,
        error: "nft warning",
        refetch: vi.fn(),
      };
    });
    mocks.useStoryData.mockImplementation((tokenId) => {
      if (!tokenId) return emptyQuery;
      return {
        data: {
          chunks: [
            {
              chunkIndex: 0,
              chunkHash: "0xchunk",
              content: "story",
              timestamp: 456,
              editor: "0xeditor",
              chunkType: 0,
              attachmentCID: "",
            },
          ],
          fullStory: "story",
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
            lastUpdateTime: 456,
            fullStoryHash: "0xstory",
          },
          loading: false,
          fetchedAt: 999,
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    render(
      <NodeDetailProvider>
        <Harness />
      </NodeDetailProvider>,
    );

    await act(async () => {
      screen.getByText("open").click();
    });

    expect(mocks.usePersonDetails).toHaveBeenLastCalledWith("0xperson", 2);
    expect(mocks.useNFTDetails).toHaveBeenLastCalledWith("42");
    expect(mocks.useStoryData).toHaveBeenLastCalledWith("42");
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("error").textContent).toBe("nft warning");

    await waitFor(() => expect(mocks.setNodesData).toHaveBeenCalledTimes(2));

    const versionUpdater = mocks.setNodesData.mock.calls[0][0];
    const nftUpdater = mocks.setNodesData.mock.calls[1][0];
    const afterVersion = versionUpdater(mocks.nodesData);
    const afterNft = nftUpdater(afterVersion);
    const updatedNode = afterNft[makeNodeId("0xperson", 2)];

    expect(updatedNode).toMatchObject({
      tokenId: "42",
      fatherHash: "0xfather",
      motherHash: "0xmother",
      metadataCID: "cid://nft-meta",
      endorsementCount: 9,
      fullName: "Fetched Ada",
      gender: 2,
      birthPlace: "London",
      nftTokenURI: "ipfs://token",
      storyFetchedAt: 999,
    });
    expect(updatedNode?.storyChunks?.[0]?.content).toBe("story");
    expect(updatedNode?.storyMetadata?.totalChunks).toBe(1);
  });
});
