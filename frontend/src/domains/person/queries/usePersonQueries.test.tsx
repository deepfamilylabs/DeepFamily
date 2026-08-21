// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryChunk, StoryMetadata } from "../../../shared/model";
import { TTL } from "../../../shared/cache/ttl";
import { useNFTDetails } from "./useNFTDetails";
import { usePersonDetails } from "./usePersonDetails";
import { useStoryData } from "./useStoryData";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const mocks = vi.hoisted(() => ({
  gateway: {
    getVersionDetails: vi.fn(),
    getNFTDetails: vi.fn(),
    getStoryMetadata: vi.fn(),
    getStoryChunks: vi.fn(),
  },
  gatewayEnabled: true,
}));

vi.mock("./usePersonGateway", () => ({
  usePersonGateway: () => (mocks.gatewayEnabled ? mocks.gateway : null),
}));

const storyMetadata = (overrides: Partial<StoryMetadata> = {}): StoryMetadata => ({
  totalChunks: 0,
  totalLength: 0,
  isSealed: false,
  lastUpdateTime: 0,
  fullStoryHash: "",
  ...overrides,
});

const storyChunk = (chunkIndex: number, content: string): StoryChunk => ({
  chunkIndex,
  chunkHash: `0x${String(chunkIndex + 1).repeat(64).slice(0, 64)}`,
  content,
  timestamp: 100 + chunkIndex,
  editor: "0x00000000000000000000000000000000000000aa",
  chunkType: 0,
  attachmentCID: "",
});

describe("person query hooks", () => {
  beforeEach(() => {
    mocks.gatewayEnabled = true;
    mocks.gateway.getVersionDetails.mockReset();
    mocks.gateway.getNFTDetails.mockReset();
    mocks.gateway.getStoryMetadata.mockReset();
    mocks.gateway.getStoryChunks.mockReset();
  });

  it("usePersonDetails fetches version details with TTL and exposes loading/data", async () => {
    const deferred = createDeferred<any>();
    mocks.gateway.getVersionDetails.mockReturnValue(deferred.promise);

    const { result } = renderHook(() => usePersonDetails("0xperson", 2));

    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(mocks.gateway.getVersionDetails).toHaveBeenCalledWith("0xperson", 2, {
      ttlMs: TTL.versionDetails,
    });

    await act(async () => {
      deferred.resolve({
        version: { versionCommitment: "0xcommitment" },
        metadata: {
          pointer: "0x00000000000000000000000000000000000000cc",
          payloadHash: "0xpayload",
          payloadLength: 512,
        },
        endorsementCount: 7,
        tokenId: "42",
      });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toMatchObject({
      endorsementCount: 7,
      tokenId: "42",
      version: { versionCommitment: "0xcommitment" },
      metadata: {
        pointer: "0x00000000000000000000000000000000000000cc",
        payloadHash: "0xpayload",
        payloadLength: 512,
      },
    });
    expect(result.current.error).toBeNull();
  });

  it("usePersonDetails stays disabled without a gateway or valid key", () => {
    mocks.gatewayEnabled = false;
    const disabledGateway = renderHook(() => usePersonDetails("0xperson", 2));
    expect(disabledGateway.result.current).toMatchObject({
      data: null,
      loading: false,
      error: null,
    });

    mocks.gatewayEnabled = true;
    const invalidVersion = renderHook(() => usePersonDetails("0xperson", 0));
    expect(invalidVersion.result.current.loading).toBe(false);
    expect(mocks.gateway.getVersionDetails).not.toHaveBeenCalled();
  });

  it("useNFTDetails skips zero token ids and surfaces gateway errors", async () => {
    const skipped = renderHook(() => useNFTDetails("0"));
    expect(skipped.result.current.loading).toBe(false);
    expect(mocks.gateway.getNFTDetails).not.toHaveBeenCalled();

    mocks.gateway.getNFTDetails.mockRejectedValue(new Error("nft unavailable"));
    const failed = renderHook(() => useNFTDetails("42"));

    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    expect(mocks.gateway.getNFTDetails).toHaveBeenCalledWith("42", {
      ttlMs: TTL.nftDetails,
    });
    expect(failed.result.current.data).toBeNull();
    expect(failed.result.current.error).toBe("nft unavailable");
  });

  it("useStoryData fetches metadata and chunks into a story result", async () => {
    mocks.gateway.getStoryMetadata.mockResolvedValue(
      storyMetadata({
        totalChunks: 2,
        totalLength: 10,
        isSealed: true,
        lastUpdateTime: 123,
        fullStoryHash: "0xstory",
      }),
    );
    mocks.gateway.getStoryChunks.mockResolvedValue([
      storyChunk(0, "hello"),
      storyChunk(1, "world"),
    ]);

    const { result } = renderHook(() => useStoryData("42"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.gateway.getStoryMetadata).toHaveBeenCalledWith("42", {
      ttlMs: TTL.story,
    });
    expect(mocks.gateway.getStoryChunks).toHaveBeenCalledWith("42", 0, 50);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.metadata.totalChunks).toBe(2);
    expect(result.current.data?.chunks.map((chunk) => chunk.content)).toEqual(["hello", "world"]);
    expect(result.current.data?.fullStory).toBe("helloworld");
  });

  it("useStoryData handles empty stories and gateway errors", async () => {
    mocks.gateway.getStoryMetadata.mockResolvedValue(storyMetadata());
    const empty = renderHook(() => useStoryData("7"));

    await waitFor(() => expect(empty.result.current.loading).toBe(false));
    expect(empty.result.current.data?.chunks).toEqual([]);
    expect(empty.result.current.data?.fullStory).toBe("");
    expect(mocks.gateway.getStoryChunks).not.toHaveBeenCalled();

    mocks.gateway.getStoryMetadata.mockReset();
    mocks.gateway.getStoryMetadata.mockRejectedValue(new Error("story unavailable"));
    const failed = renderHook(() => useStoryData("8"));

    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    expect(failed.result.current.data).toBeNull();
    expect(failed.result.current.error).toBe("story unavailable");
  });
});
