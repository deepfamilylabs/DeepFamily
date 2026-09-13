// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddStoryRecordFlow } from "./useAddStoryRecordFlow";
import { useSealStoryFlow } from "./useSealStoryFlow";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: { getAddress: vi.fn() },
  } as { signer: any },
  config: {
    contractAddress: "0x0000000000000000000000000000000000000abc",
  },
  addStoryRecordService: vi.fn(),
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

vi.mock("../services/addStoryRecordService", () => ({
  addStoryRecordService: mocks.addStoryRecordService,
}));

vi.mock("../services/sealStoryService", () => ({
  sealStoryService: mocks.sealStoryService,
}));

describe("story transaction flows", () => {
  beforeEach(() => {
    mocks.wallet.signer = { getAddress: vi.fn() };
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.addStoryRecordService.mockReset();
    mocks.sealStoryService.mockReset();
  });

  it("useAddStoryRecordFlow delegates to addStoryRecordService and stores the result", async () => {
    const serviceResult = {
      recordIndex: 2,
      payloadLength: 5,
      transactionHash: "0xrecord",
      blockNumber: 10,
      newRecord: {
        title: "",
        recordIndex: 2,
        payloadHash: "0xhash",
        content: "hello",
        timestamp: 1,
        author: "0xeditor",
      },
      events: { StoryRecordAppended: null },
    };
    mocks.addStoryRecordService.mockResolvedValue(serviceResult);

    const { result } = renderHook(() => useAddStoryRecordFlow());

    await act(async () => {
      await expect(
        result.current.runOrThrow({
          title: "",
          tokenId: "7",
          recordIndex: 2,
          content: "hello",
          expectedPayloadHash: "0xexpected",
          recordType: 1,
          attachmentCID: "ipfs://record",
        }),
      ).resolves.toBe(serviceResult);
    });

    expect(mocks.addStoryRecordService).toHaveBeenCalledWith(
      mocks.wallet.signer,
      mocks.config.contractAddress,
      "7",
      2,
      "",
      "hello",
      "0xexpected",
      1,
      "ipfs://record",
      undefined,
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toBe(serviceResult);
  });

  it("useSealStoryFlow delegates to sealStoryService and stores the result", async () => {
    const serviceResult = {
      totalRecords: 3,
      recordsHead: "0xfull",
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
      undefined,
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toBe(serviceResult);
  });

  it("fails before service execution when wallet or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const addFlow = renderHook(() => useAddStoryRecordFlow());
    await act(async () => {
      await expect(
        addFlow.result.current.runOrThrow({
          title: "",
          tokenId: "7",
          recordIndex: 0,
          content: "hello",
          expectedPayloadHash: "",
        }),
      ).rejects.toThrow("Please connect your wallet");
    });
    expect(mocks.addStoryRecordService).not.toHaveBeenCalled();
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
