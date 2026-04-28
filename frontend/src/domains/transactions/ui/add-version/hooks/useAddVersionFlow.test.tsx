// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddVersionFlow } from "./useAddVersionFlow";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: {
      id: "signer",
      getAddress: vi.fn(async () => "0x00000000000000000000000000000000000000aa"),
    },
  } as { signer: any },
  config: {
    rpcUrl: "https://rpc.example",
    chainId: 123,
    contractAddress: "0x0000000000000000000000000000000000000abc",
  },
  readonlyProvider: { id: "readonly-provider" },
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
  proof: { pi_a: [], pi_b: [], pi_c: [], protocol: "groth16" } as any,
  publicSignals: {
    identityCommitment: 1n,
    fatherIdentityCommitment: 0n,
    motherIdentityCommitment: 0n,
    submitter: 2n,
    schemaVersion: 1,
    cryptoSuiteVersion: 1,
    hashAlgoId: 1,
  },
  fatherVersionIndex: 0,
  motherVersionIndex: 0,
  tag: "v1",
  metadataCID: "ipfs://metadata",
};

describe("useAddVersionFlow", () => {
  beforeEach(() => {
    mocks.wallet.signer = {
      id: "signer",
      getAddress: vi.fn(async () => "0x00000000000000000000000000000000000000aa"),
    };
    mocks.config.rpcUrl = "https://rpc.example";
    mocks.config.chainId = 123;
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.createDeepFamilyContract.mockReset();
    mocks.getReadonlyProvider.mockReset();
    mocks.executeAddVersionFlow.mockReset();
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
        tag: "v1",
        metadataCID: "ipfs://metadata",
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
