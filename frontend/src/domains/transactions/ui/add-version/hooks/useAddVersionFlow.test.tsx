// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddVersionFlow } from "./useAddVersionFlow";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: {
      id: "signer",
      getAddress: vi.fn(async () => "0x00000000000000000000000000000000000000aa"),
      provider: { send: vi.fn(async () => "0x7b") },
    },
  } as { signer: any },
  config: {
    rpcUrl: "https://rpc.example",
    chainId: 123,
    contractAddress: "0x0000000000000000000000000000000000000abc",
    readerAddress: "0x0000000000000000000000000000000000000def",
  },
  readonlyProvider: { id: "readonly-provider", getTransactionReceipt: vi.fn() },
  submitContract: { id: "submit-contract" },
  preflightContract: { id: "preflight-contract" },
  createDeepFamilyContract: vi.fn(),
  getReadonlyProvider: vi.fn(),
  executeAddVersionFlow: vi.fn(),
}));

vi.mock("../../../../wallet", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("../../../../config", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../../../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: mocks.createDeepFamilyContract,
}));

vi.mock("../../../../../shared/clients/providerRegistry", () => ({
  getReadonlyProvider: mocks.getReadonlyProvider,
}));

vi.mock("../../../services/addVersionService", () => ({
  executeAddVersionFlow: mocks.executeAddVersionFlow,
}));

const flowArgs = {
  proof: { circuitId: 1, proofEncodingId: 1, proofData: "0x1234" } as any,
  publicSignals: {
    identityCommitment: 1n,
    fatherIdentityCommitment: 0n,
    motherIdentityCommitment: 0n,
    submitterAndSelfSuiteId: 2n,
    versionCommitment: 3n,
  },
  fatherVersionIndex: 0,
  motherVersionIndex: 0,
  metadataEnvelope: new Uint8Array([0x44, 0x46, 0x4d, 0x31]),
};

describe("useAddVersionFlow", () => {
  beforeEach(() => {
    mocks.wallet.signer = {
      id: "signer",
      getAddress: vi.fn(async () => "0x00000000000000000000000000000000000000aa"),
      provider: { send: vi.fn(async () => "0x7b") },
    };
    mocks.config.rpcUrl = "https://rpc.example";
    mocks.config.chainId = 123;
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.config.readerAddress = "0x0000000000000000000000000000000000000def";
    mocks.createDeepFamilyContract.mockReset();
    mocks.getReadonlyProvider.mockReset();
    mocks.executeAddVersionFlow.mockReset();
    mocks.readonlyProvider.getTransactionReceipt.mockReset();
    mocks.getReadonlyProvider.mockReturnValue(mocks.readonlyProvider);
    mocks.createDeepFamilyContract.mockImplementation((_address, runner) =>
      runner === mocks.wallet.signer ? mocks.submitContract : mocks.preflightContract,
    );
  });

  it("uses signer contract for submit and readonly contract for preflight when rpcUrl exists", async () => {
    const serviceResult = {
      hash: "0xperson",
      index: 1,
      rewardAmount: 0,
      transactionHash: "0xtx",
      blockNumber: 10,
      events: {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        MetadataStored: null,
        TokenRewardDistributed: null,
      },
    };
    mocks.executeAddVersionFlow.mockImplementation(async (params) => {
      params.onTransactionSubmitted?.("0xtx");
      return serviceResult;
    });

    const { result } = renderHook(() => useAddVersionFlow());

    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).resolves.toBe(serviceResult);
    });

    expect(mocks.getReadonlyProvider).toHaveBeenCalledWith("https://rpc.example", 123);
    expect(mocks.createDeepFamilyContract).toHaveBeenCalledWith(
      mocks.config.contractAddress,
      mocks.wallet.signer,
    );
    expect(mocks.createDeepFamilyContract).toHaveBeenCalledWith(
      mocks.config.contractAddress,
      mocks.readonlyProvider,
    );
    expect(mocks.executeAddVersionFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        submitContract: mocks.submitContract,
        preflightContract: mocks.preflightContract,
        contractAddress: mocks.config.contractAddress,
        submitterAddress: "0x00000000000000000000000000000000000000aa",
        proof: flowArgs.proof,
        publicSignals: flowArgs.publicSignals,
        fatherVersionIndex: 0,
        motherVersionIndex: 0,
        metadataEnvelope: flowArgs.metadataEnvelope,
        isDev: expect.any(Boolean),
        onTransactionSubmitted: expect.any(Function),
      }),
    );
    expect(result.current.state).toEqual({ step: "success", result: serviceResult });
  });

  it("uses submit contract for preflight when rpcUrl is empty", async () => {
    mocks.config.rpcUrl = "";
    mocks.executeAddVersionFlow.mockResolvedValue({
      hash: "0xperson",
      index: 1,
      rewardAmount: 0,
      transactionHash: "0xtx",
      blockNumber: 10,
      events: {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        MetadataStored: null,
        TokenRewardDistributed: null,
      },
    });

    const { result } = renderHook(() => useAddVersionFlow());

    await act(async () => {
      await result.current.runOrThrow(flowArgs);
    });

    expect(mocks.getReadonlyProvider).not.toHaveBeenCalled();
    expect(mocks.executeAddVersionFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        submitContract: mocks.submitContract,
        preflightContract: mocks.submitContract,
      }),
    );
  });

  it("reconciles the exact submitted hash on retry without rebuilding the frozen package", async () => {
    const transactionHash = `0x${"aa".repeat(32)}`;
    const receipt = { hash: transactionHash, status: 1, blockNumber: 10, logs: [] };
    const serviceResult = {
      hash: "0xperson",
      index: 1,
      rewardAmount: 0,
      transactionHash,
      blockNumber: 10,
      events: {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        MetadataStored: null,
        TokenRewardDistributed: null,
      },
    };
    mocks.readonlyProvider.getTransactionReceipt.mockResolvedValue(receipt);
    mocks.executeAddVersionFlow
      .mockImplementationOnce(async (params) => {
        params.onTransactionSubmitted?.(transactionHash);
        throw new Error("RPC timeout while waiting for receipt");
      })
      .mockResolvedValueOnce(serviceResult);

    const { result } = renderHook(() => useAddVersionFlow());

    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).rejects.toThrow("RPC timeout");
    });
    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).resolves.toBe(serviceResult);
    });

    expect(mocks.executeAddVersionFlow).toHaveBeenCalledTimes(2);
    const first = mocks.executeAddVersionFlow.mock.calls[0][0];
    const second = mocks.executeAddVersionFlow.mock.calls[1][0];
    expect(first.reconcileTransactionHash).toBeUndefined();
    expect(second.reconcileTransactionHash).toBe(transactionHash);
    expect(second.proof).toBe(first.proof);
    expect(second.publicSignals).toBe(first.publicSignals);
    expect(second.metadataEnvelope).toBe(first.metadataEnvelope);
    await expect(second.getTransactionReceipt(transactionHash)).resolves.toBe(receipt);
    expect(mocks.readonlyProvider.getTransactionReceipt).toHaveBeenCalledWith(transactionHash);
    expect(result.current.state).toEqual({ step: "success", result: serviceResult });
  });

  it("reconciles the final exact replacement hash rather than the superseded hash", async () => {
    const originalHash = `0x${"11".repeat(32)}`;
    const replacementHash = `0x${"22".repeat(32)}`;
    const serviceResult = {
      hash: "0xperson",
      index: 1,
      rewardAmount: 0,
      transactionHash: replacementHash,
      blockNumber: 10,
      events: {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        MetadataStored: null,
        TokenRewardDistributed: null,
      },
    };
    mocks.executeAddVersionFlow
      .mockImplementationOnce(async (params) => {
        params.onTransactionSubmitted?.(originalHash);
        params.onTransactionSubmitted?.(replacementHash);
        throw new Error("RPC timeout after exact replacement");
      })
      .mockResolvedValueOnce(serviceResult);

    const { result } = renderHook(() => useAddVersionFlow());
    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).rejects.toThrow("RPC timeout");
    });
    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).resolves.toBe(serviceResult);
    });

    expect(mocks.executeAddVersionFlow.mock.calls[1][0].reconcileTransactionHash).toBe(
      replacementHash,
    );
    expect(mocks.executeAddVersionFlow.mock.calls[1][0].proof).toBe(flowArgs.proof);
    expect(mocks.executeAddVersionFlow.mock.calls[1][0].metadataEnvelope).toBe(
      flowArgs.metadataEnvelope,
    );
  });

  it("drops a submitted hash and fails closed when its chain scope changes", async () => {
    const transactionHash = `0x${"aa".repeat(32)}`;
    mocks.executeAddVersionFlow.mockImplementationOnce(async (params) => {
      params.onTransactionSubmitted?.(transactionHash);
      throw new Error("RPC timeout while waiting for receipt");
    });

    const { result, rerender } = renderHook(() => useAddVersionFlow());
    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).rejects.toThrow("RPC timeout");
    });

    mocks.config.chainId = 124;
    mocks.wallet.signer.provider.send.mockResolvedValue("0x7c");
    rerender();
    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).rejects.toMatchObject({
        code: "ADD_VERSION_SCOPE_CHANGED",
      });
    });

    expect(mocks.executeAddVersionFlow).toHaveBeenCalledTimes(1);
  });

  it("does not commit a pending result after the Reader scope changes", async () => {
    let resolveService!: (value: any) => void;
    const pendingService = new Promise((resolve) => {
      resolveService = resolve;
    });
    mocks.executeAddVersionFlow.mockImplementation(async (params) => {
      params.onTransactionSubmitted?.(`0x${"66".repeat(32)}`);
      return await pendingService;
    });
    const serviceResult = {
      hash: "0xperson",
      index: 1,
      rewardAmount: 0,
      transactionHash: `0x${"66".repeat(32)}`,
      blockNumber: 10,
      events: {
        PersonHashZKVerified: null,
        PersonVersionAdded: null,
        MetadataStored: null,
        TokenRewardDistributed: null,
      },
    };

    const { result, rerender } = renderHook(() => useAddVersionFlow());
    let pending!: Promise<any>;
    act(() => {
      pending = result.current.runOrThrow(flowArgs);
    });
    await vi.waitFor(() => expect(mocks.executeAddVersionFlow).toHaveBeenCalledTimes(1));

    mocks.config.readerAddress = "0x0000000000000000000000000000000000000fed";
    rerender();
    resolveService(serviceResult);
    await act(async () => {
      await expect(pending).rejects.toMatchObject({ code: "ADD_VERSION_SCOPE_CHANGED" });
    });

    expect(result.current.state.step).not.toBe("success");
  });

  it("rejects a lagging config when the wallet provider already switched chains", async () => {
    mocks.wallet.signer.provider.send.mockResolvedValue("0x7c");
    const { result } = renderHook(() => useAddVersionFlow());

    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).rejects.toMatchObject({
        code: "ADD_VERSION_SCOPE_CHANGED",
      });
    });

    expect(mocks.executeAddVersionFlow).not.toHaveBeenCalled();
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
  });

  it("fails before contract creation when wallet or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const missingWallet = renderHook(() => useAddVersionFlow());
    await act(async () => {
      await expect(missingWallet.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingWallet.result.current.state.step).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeAddVersionFlow).not.toHaveBeenCalled();

    mocks.wallet.signer = {
      id: "signer",
      getAddress: vi.fn(async () => "0x00000000000000000000000000000000000000aa"),
      provider: { send: vi.fn(async () => "0x7b") },
    };
    mocks.config.contractAddress = "";

    const missingContract = renderHook(() => useAddVersionFlow());
    await act(async () => {
      await expect(missingContract.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingContract.result.current.state.step).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeAddVersionFlow).not.toHaveBeenCalled();
  });
});
