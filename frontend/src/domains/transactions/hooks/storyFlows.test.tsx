// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddStoryChunkFlow } from "./useAddStoryChunkFlow";
import { useSealStoryFlow } from "./useSealStoryFlow";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: { getAddress: vi.fn() },
  } as { signer: any },
  config: {
    contractAddress: "0x0000000000000000000000000000000000000abc",
  },
  addStoryChunkService: vi.fn(),
  sealStoryService: vi.fn(),
}));

vi.mock("../../wallet", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("../../config", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../services/addStoryChunkService", () => ({
  addStoryChunkService: mocks.addStoryChunkService,
}));

vi.mock("../services/sealStoryService", () => ({
  sealStoryService: mocks.sealStoryService,
}));

describe("story transaction flows", () => {
  beforeEach(() => {
    mocks.wallet.signer = { getAddress: vi.fn() };
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.addStoryChunkService.mockReset();
    mocks.sealStoryService.mockReset();
  });

  it("useAddStoryChunkFlow delegates to addStoryChunkService and stores the result", async () => {
    const serviceResult = {
      chunkIndex: 2,
      contentLength: 5,
      transactionHash: "0xchunk",
      blockNumber: 10,
      newChunk: {
        chunkIndex: 2,
        chunkHash: "0xhash",
        content: "hello",
        timestamp: 1,
        editor: "0xeditor",
      },
      events: { StoryChunkAdded: null },
    };
    mocks.addStoryChunkService.mockResolvedValue(serviceResult);

    const { result } = renderHook(() => useAddStoryChunkFlow());

    await act(async () => {
      await expect(
        result.current.runOrThrow({
          tokenId: "7",
          chunkIndex: 2,
          content: "hello",
          expectedHash: "0xexpected",
          chunkType: 1,
          attachmentCID: "ipfs://chunk",
        }),
      ).resolves.toBe(serviceResult);
    });

    expect(mocks.addStoryChunkService).toHaveBeenCalledWith(
      mocks.wallet.signer,
      mocks.config.contractAddress,
      "7",
      2,
      "hello",
      "0xexpected",
      1,
      "ipfs://chunk",
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toBe(serviceResult);
  });

  it("useSealStoryFlow delegates to sealStoryService and stores the result", async () => {
    const serviceResult = {
      totalChunks: 3,
      fullStoryHash: "0xfull",
      transactionHash: "0xseal",
      blockNumber: 11,
      events: { StorySealed: null },
    };
    mocks.sealStoryService.mockResolvedValue(serviceResult);

    const { result } = renderHook(() => useSealStoryFlow());

    await act(async () => {
      await expect(result.current.runOrThrow({ tokenId: "9" })).resolves.toBe(serviceResult);
    });

    expect(mocks.sealStoryService).toHaveBeenCalledWith(
      mocks.wallet.signer,
      mocks.config.contractAddress,
      "9",
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toBe(serviceResult);
  });

  it("fails before service execution when wallet or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const addFlow = renderHook(() => useAddStoryChunkFlow());
    await act(async () => {
      await expect(
        addFlow.result.current.runOrThrow({
          tokenId: "7",
          chunkIndex: 0,
          content: "hello",
          expectedHash: "",
        }),
      ).rejects.toThrow("Please connect your wallet");
    });
    expect(mocks.addStoryChunkService).not.toHaveBeenCalled();
    expect(addFlow.result.current.status).toBe("error");

    mocks.wallet.signer = { getAddress: vi.fn() };
    mocks.config.contractAddress = "";

    const sealFlow = renderHook(() => useSealStoryFlow());
    await act(async () => {
      await expect(sealFlow.result.current.runOrThrow({ tokenId: "9" })).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(mocks.sealStoryService).not.toHaveBeenCalled();
    expect(sealFlow.result.current.status).toBe("error");
  });
});
