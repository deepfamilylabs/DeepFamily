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
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(serviceResult);
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

  it("shows the shared local nonce guidance when the wallet rejects a send", async () => {
    const error = Object.assign(new Error("could not coalesce error"), {
      code: "UNKNOWN_ERROR",
      info: {
        error: {
          message: "RPC 0x7a69 eth_sendRawTransaction: Nonce too high. Expected 1344 but got 1353",
        },
      },
    });
    mocks.executeAddVersionFlow.mockRejectedValue(error);
    const { result } = renderHook(() => useAddVersionFlow());

    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).rejects.toThrow("could not coalesce error");
    });

    expect(result.current.error).toMatchObject({
      type: "LOCAL_NONCE_TOO_HIGH",
      message: expect.stringContaining("Clear activity and nonce data"),
    });
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
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(serviceResult);
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

    expect(result.current.status).not.toBe("success");
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

  it.each(["reset", "unmount"] as const)(
    "declines a delayed preview after the request is cancelled by %s",
    async (cancel) => {
      let resolveEstimate!: () => void;
      const pendingEstimate = new Promise<void>((resolve) => {
        resolveEstimate = resolve;
      });
      const confirmTransactionPreview = vi.fn(async () => true);
      const walletRequest = vi.fn();
      mocks.executeAddVersionFlow.mockImplementation(async (params) => {
        await pendingEstimate;
        if (!(await params.confirmTransactionPreview({}))) {
          throw Object.assign(new Error("Preview declined"), {
            code: "ADD_VERSION_PREVIEW_REJECTED",
          });
        }
        await params.assertWalletScope();
        walletRequest();
        return {};
      });
      const hook = renderHook(() => useAddVersionFlow({ confirmTransactionPreview }));
      let pending!: Promise<any>;
      act(() => {
        pending = hook.result.current.runOrThrow(flowArgs);
      });
      await vi.waitFor(() => expect(mocks.executeAddVersionFlow).toHaveBeenCalledOnce());
      act(() => {
        if (cancel === "reset") hook.result.current.reset();
        else hook.unmount();
      });
      await act(async () => {
        resolveEstimate();
        await expect(pending).rejects.toMatchObject({ code: "ADD_VERSION_PREVIEW_REJECTED" });
      });

      expect(confirmTransactionPreview).not.toHaveBeenCalled();
      expect(walletRequest).not.toHaveBeenCalled();
    },
  );

  it("declines an approved preview if its request was reset while awaiting the decision", async () => {
    let resolveDecision!: (approved: boolean) => void;
    const confirmTransactionPreview = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDecision = resolve;
        }),
    );
    const walletRequest = vi.fn();
    mocks.executeAddVersionFlow.mockImplementation(async (params) => {
      if (!(await params.confirmTransactionPreview({}))) {
        throw Object.assign(new Error("Preview declined"), {
          code: "ADD_VERSION_PREVIEW_REJECTED",
        });
      }
      await params.assertWalletScope();
      walletRequest();
      return {};
    });
    const { result } = renderHook(() => useAddVersionFlow({ confirmTransactionPreview }));
    let pending!: Promise<any>;
    act(() => {
      pending = result.current.runOrThrow(flowArgs);
    });
    await vi.waitFor(() => expect(confirmTransactionPreview).toHaveBeenCalledOnce());
    act(() => result.current.reset());
    await act(async () => {
      resolveDecision(true);
      await expect(pending).rejects.toMatchObject({ code: "ADD_VERSION_PREVIEW_REJECTED" });
    });

    expect(walletRequest).not.toHaveBeenCalled();
  });

  it("stops before sending when reset occurs during the final wallet scope RPC", async () => {
    let resolveWalletChain!: (value: string) => void;
    mocks.wallet.signer.provider.send.mockResolvedValueOnce("0x7b").mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveWalletChain = resolve;
        }),
    );
    const walletRequest = vi.fn();
    mocks.executeAddVersionFlow.mockImplementation(async (params) => {
      await params.assertWalletScope();
      walletRequest();
      return {};
    });
    const { result } = renderHook(() => useAddVersionFlow());
    let pending!: Promise<any>;
    act(() => {
      pending = result.current.runOrThrow(flowArgs);
    });
    await vi.waitFor(() => expect(mocks.wallet.signer.provider.send).toHaveBeenCalledTimes(2));
    act(() => result.current.reset());
    await act(async () => {
      resolveWalletChain("0x7b");
      await expect(pending).rejects.toMatchObject({ code: "ADD_VERSION_PREVIEW_REJECTED" });
    });

    expect(walletRequest).not.toHaveBeenCalled();
  });

  it.each(["reset", "unmount", "reset then change Reader"] as const)(
    "returns the confirmed broadcast result after %s without updating the closed flow",
    async (close) => {
      let resolveReceipt!: (value: any) => void;
      const pendingReceipt = new Promise((resolve) => {
        resolveReceipt = resolve;
      });
      const transactionHash = `0x${"77".repeat(32)}`;
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
      mocks.executeAddVersionFlow.mockImplementation(async (params) => {
        await params.assertWalletScope();
        params.onTransactionSubmitted(transactionHash);
        return pendingReceipt;
      });
      const hook = renderHook(() => useAddVersionFlow());
      let pending!: Promise<any>;
      act(() => {
        pending = hook.result.current.runOrThrow(flowArgs);
      });
      await vi.waitFor(() => expect(hook.result.current.status).toBe("confirming"));
      act(() => {
        if (close === "unmount") hook.unmount();
        else hook.result.current.reset();
      });
      if (close === "reset then change Reader") {
        mocks.config.readerAddress = "0x0000000000000000000000000000000000000fed";
        hook.rerender();
      }
      await act(async () => {
        resolveReceipt(serviceResult);
        await expect(pending).resolves.toBe(serviceResult);
      });

      if (close !== "unmount") {
        expect(hook.result.current.status).toBe("idle");
        expect(hook.result.current.result).toBeNull();
      }
    },
  );

  it("keeps a newer package's reconciliation hash when an older background transaction completes", async () => {
    let resolveOldReceipt!: (value: any) => void;
    const pendingOldReceipt = new Promise((resolve) => {
      resolveOldReceipt = resolve;
    });
    const oldHash = `0x${"88".repeat(32)}`;
    const replacementHash = `0x${"99".repeat(32)}`;
    const newHash = `0x${"aa".repeat(32)}`;
    const newerArgs = { ...flowArgs, metadataEnvelope: new Uint8Array([1, 2, 3]) };
    const oldResult = { transactionHash: replacementHash };
    const newResult = { transactionHash: newHash };
    let reportOldHash!: (hash: string) => void;
    mocks.executeAddVersionFlow
      .mockImplementationOnce(async (params) => {
        reportOldHash = params.onTransactionSubmitted;
        reportOldHash(oldHash);
        return pendingOldReceipt;
      })
      .mockImplementationOnce(async (params) => {
        params.onTransactionSubmitted(newHash);
        throw new Error("New transaction receipt timeout");
      })
      .mockResolvedValueOnce(newResult);
    const { result } = renderHook(() => useAddVersionFlow());
    let oldPending!: Promise<any>;
    act(() => {
      oldPending = result.current.runOrThrow(flowArgs);
    });
    await vi.waitFor(() => expect(result.current.status).toBe("confirming"));
    act(() => result.current.reset());
    await act(async () => {
      await expect(result.current.runOrThrow(newerArgs)).rejects.toThrow("receipt timeout");
    });
    await act(async () => {
      reportOldHash(replacementHash);
      resolveOldReceipt(oldResult);
      await expect(oldPending).resolves.toBe(oldResult);
    });
    await act(async () => {
      await expect(result.current.runOrThrow(newerArgs)).resolves.toBe(newResult);
    });

    expect(mocks.executeAddVersionFlow.mock.calls[2][0].reconcileTransactionHash).toBe(newHash);
  });

  it("fails before contract creation when wallet or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const missingWallet = renderHook(() => useAddVersionFlow());
    await act(async () => {
      await expect(missingWallet.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingWallet.result.current.status).toBe("error");
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
    expect(missingContract.result.current.status).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeAddVersionFlow).not.toHaveBeenCalled();
  });
});
