// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEndorseFlow } from "./useEndorseFlow";
import { Interface } from "ethers";
import { contractFeeReplacement } from "../../../test-helpers/contractReplacement";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: { id: "signer", getAddress: async () => "0x00000000000000000000000000000000000000aa", provider: { getBlockNumber: async () => 12, getNetwork: async () => ({ chainId: 31337n }) } },
    address: "0x00000000000000000000000000000000000000aa",
  } as { signer: any; address: string | null },
  config: {
    contractAddress: "0x0000000000000000000000000000000000000abc",
    chainId: 31337,
  },
  tx: { replaceableTransaction() { return this; }, hash: "0xendorse", wait: vi.fn() },
  receipt: { status: 1, transactionHash: "0xendorse", blockNumber: 20 },
  contract: {
    endorseVersion: vi.fn(),
  },
  createDeepFamilyContract: vi.fn(),
  receiptWait: vi.fn(),
  executeEndorseFlow: vi.fn(),
}));

vi.mock("../../../../wallet", () => ({
  useWallet: () => mocks.wallet,
  getWalletConnectionGeneration: () => 0,
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

vi.mock("../../../services/endorseService", () => ({
  executeEndorseFlow: mocks.executeEndorseFlow,
}));

const flowArgs = {
  personHash: "0xperson",
  versionIndex: 2,
  deepTokenAddress: "0xtoken",
};

describe("useEndorseFlow", () => {
  beforeEach(() => {
    mocks.wallet.signer = { id: "signer", getAddress: async () => "0x00000000000000000000000000000000000000aa", provider: { getBlockNumber: async () => 12, getNetwork: async () => ({ chainId: 31337n }) } };
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.contract.endorseVersion.mockReset();
    mocks.createDeepFamilyContract.mockReset();
    mocks.receiptWait.mockReset();
    mocks.executeEndorseFlow.mockReset();
    mocks.tx.wait = mocks.receiptWait;
    mocks.contract.endorseVersion.mockResolvedValue(mocks.tx);
    mocks.createDeepFamilyContract.mockReturnValue(mocks.contract);
    mocks.receiptWait.mockResolvedValue(mocks.receipt);
  });

  it("discovers a fee replacement through the real ethers contract response", async () => {
    const personHash = `0x${"11".repeat(32)}`;
    const eventInterface = new Interface(["function endorseVersion(bytes32,uint256)"]);
    const tracked = contractFeeReplacement({
      eventInterface, receipt: { status: 1 }, from: mocks.wallet.address!,
      to: mocks.config.contractAddress,
      data: eventInterface.encodeFunctionData("endorseVersion", [personHash, 2]),
    });
    mocks.createDeepFamilyContract.mockReturnValue({ ...mocks.contract, interface: eventInterface });
    mocks.contract.endorseVersion.mockResolvedValue(tracked.transaction);
    mocks.executeEndorseFlow.mockImplementation(async (params) => {
      const receipt = await params.endorseVersion(personHash, 2);
      return { alreadyEndorsed: false, receipt, transactionHash: tracked.transactionHash };
    });
    const { result } = renderHook(() => useEndorseFlow());
    await act(async () => { await result.current.runOrThrow({ ...flowArgs, personHash }); });
    expect(tracked.wasScanned()).toBe(true);
    expect(mocks.contract.endorseVersion).toHaveBeenCalledExactlyOnceWith(personHash, 2);
    expect(result.current.tracking).toMatchObject({
      state: "confirmed", transactionHash: tracked.transactionHash,
    });
  }, 1500);

  it("passes endorsement dependencies to executeEndorseFlow and maps service stages", async () => {
    const stageSpy = vi.fn();
    const serviceResult = {
      alreadyEndorsed: false,
      receipt: mocks.receipt,
      transactionHash: "0xendorse",
      blockNumber: 20,
      deepTokenAddress: "0xtoken",
      fee: 1n,
      feeFormatted: "1",
      balanceBefore: 10n,
      balanceFormatted: "10",
      decimals: 18,
      symbol: "DEEP",
      event: null,
    };
    mocks.executeEndorseFlow.mockImplementation(async (params) => {
      params.onStageChange("checking");
      params.onStageChange("approving");
      params.onStageChange("submitting");
      const receipt = await params.endorseVersion(flowArgs.personHash, flowArgs.versionIndex, {
        gasLimit: 123n,
      });
      expect(receipt).toBe(mocks.receipt);
      return serviceResult;
    });

    const { result } = renderHook(() => useEndorseFlow());

    await act(async () => {
      await expect(
        result.current.runOrThrow({
          ...flowArgs,
          onStageChange: stageSpy,
        }),
      ).resolves.toBe(serviceResult);
    });

    expect(stageSpy).toHaveBeenNthCalledWith(1, "checking");
    expect(stageSpy).toHaveBeenNthCalledWith(2, "approving");
    expect(stageSpy).toHaveBeenNthCalledWith(3, "submitting");
    expect(mocks.createDeepFamilyContract).toHaveBeenCalledWith(
      mocks.config.contractAddress,
      mocks.wallet.signer,
    );
    expect(mocks.contract.endorseVersion).toHaveBeenCalledWith(flowArgs.personHash, 2, {
      gasLimit: 123n,
    });
    expect(mocks.receiptWait).toHaveBeenCalledOnce();
    expect(mocks.executeEndorseFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: mocks.contract,
        signer: mocks.wallet.signer,
        address: mocks.wallet.address,
        personHash: flowArgs.personHash,
        versionIndex: 2,
        endorseVersion: expect.any(Function),
        deepTokenAddress: "0xtoken",
        onStageChange: expect.any(Function),
      }),
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(serviceResult);
  });

  it("calls endorseVersion without overrides when no gas overrides are provided", async () => {
    mocks.executeEndorseFlow.mockImplementation(async (params) => {
      await params.endorseVersion(flowArgs.personHash, flowArgs.versionIndex);
      return { alreadyEndorsed: true };
    });

    const { result } = renderHook(() => useEndorseFlow());

    await act(async () => {
      await result.current.runOrThrow(flowArgs);
    });

    expect(mocks.contract.endorseVersion).toHaveBeenCalledWith(flowArgs.personHash, 2);
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({ alreadyEndorsed: true });
  });

  it("fails before contract creation when wallet, address, or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const missingSigner = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(missingSigner.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingSigner.result.current.status).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeEndorseFlow).not.toHaveBeenCalled();

    mocks.wallet.signer = { id: "signer", getAddress: async () => "0x00000000000000000000000000000000000000aa", provider: { getBlockNumber: async () => 12, getNetwork: async () => ({ chainId: 31337n }) } };
    mocks.wallet.address = null;

    const missingAddress = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(missingAddress.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingAddress.result.current.status).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeEndorseFlow).not.toHaveBeenCalled();

    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.config.contractAddress = "";

    const missingContract = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(missingContract.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingContract.result.current.status).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeEndorseFlow).not.toHaveBeenCalled();
  });
  it("does not send when a reset occurs after the last stage update but before sending", async () => {
    let finishEstimate!: () => void;
    const estimate = new Promise<void>((resolve) => {
      finishEstimate = resolve;
    });
    mocks.executeEndorseFlow.mockImplementation(async (params) => {
      params.onStageChange("submitting");
      await estimate;
      return params.endorseVersion(flowArgs.personHash, flowArgs.versionIndex);
    });
    const hook = renderHook(() => useEndorseFlow());
    let pending!: Promise<any>;
    act(() => {
      pending = hook.result.current.runOrThrow(flowArgs);
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: "ENDORSEMENT_CANCELLED" });
    act(() => hook.result.current.reset());
    await act(async () => {
      finishEstimate();
      await rejected;
    });
    expect(mocks.contract.endorseVersion).not.toHaveBeenCalled();
  });

  it("returns a confirmed result to the original caller after reset without updating the new form", async () => {
    let finishReceipt!: (value: any) => void;
    mocks.receiptWait.mockReturnValue(
      new Promise((resolve) => {
        finishReceipt = resolve;
      }),
    );
    const confirmed = { alreadyEndorsed: false, transactionHash: "0xendorse" };
    mocks.executeEndorseFlow.mockImplementation(async (params) => {
      await params.endorseVersion(flowArgs.personHash, flowArgs.versionIndex);
      return confirmed;
    });
    const hook = renderHook(() => useEndorseFlow());
    let pending!: Promise<any>;
    act(() => {
      pending = hook.result.current.runOrThrow(flowArgs);
    });
    await vi.waitFor(() => expect(mocks.receiptWait).toHaveBeenCalledTimes(1));
    act(() => hook.result.current.reset());
    await act(async () => {
      finishReceipt(mocks.receipt);
      expect(await pending).toBe(confirmed);
    });
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.result).toBeNull();
  });

  it("keeps the approval confirmed if preparing the endorsement later fails", async () => {
    const approvalReceipt = {status: 1, hash: "0xapprove", blockNumber: 19};
    const failure = new Error("Endorsement gas estimation failed");
    mocks.executeEndorseFlow.mockImplementation(async (params) => {
      params.onSubmitted(approvalReceipt.hash);
      params.onApprovalConfirmed(approvalReceipt.hash, approvalReceipt);
      params.onStageChange("submitting");
      throw failure;
    });
    const hook = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(hook.result.current.runOrThrow(flowArgs)).rejects.toBe(failure);
    });
    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.tracking).toEqual({
      state: "confirmed", transactionHash: approvalReceipt.hash, receipt: approvalReceipt,
    });
    expect(mocks.contract.endorseVersion).not.toHaveBeenCalled();
  });
});
