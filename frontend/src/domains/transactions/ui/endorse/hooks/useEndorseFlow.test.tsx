// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEndorseFlow } from "./useEndorseFlow";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: { id: "signer" },
    address: "0x00000000000000000000000000000000000000aa",
  } as { signer: any; address: string | null },
  config: {
    contractAddress: "0x0000000000000000000000000000000000000abc",
  },
  tx: { hash: "0xendorse" },
  receipt: { transactionHash: "0xendorse", blockNumber: 20 },
  contract: {
    endorseVersion: vi.fn(),
  },
  createDeepFamilyContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  executeEndorseFlow: vi.fn(),
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

vi.mock("../../../api/txGateway", () => ({
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("../../../services/endorseService", () => ({
  executeEndorseFlow: mocks.executeEndorseFlow,
}));

const flowArgs = {
  personHash: "0xperson",
  versionIndex: 2,
  deepTokenAddress: "0xtoken",
  suppressToasts: true,
};

describe("useEndorseFlow", () => {
  beforeEach(() => {
    mocks.wallet.signer = { id: "signer" };
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.contract.endorseVersion.mockReset();
    mocks.createDeepFamilyContract.mockReset();
    mocks.waitForTransactionReceipt.mockReset();
    mocks.executeEndorseFlow.mockReset();
    mocks.contract.endorseVersion.mockResolvedValue(mocks.tx);
    mocks.createDeepFamilyContract.mockReturnValue(mocks.contract);
    mocks.waitForTransactionReceipt.mockResolvedValue(mocks.receipt);
  });

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
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mocks.tx);
    expect(mocks.executeEndorseFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: mocks.contract,
        signer: mocks.wallet.signer,
        address: mocks.wallet.address,
        personHash: flowArgs.personHash,
        versionIndex: 2,
        endorseVersion: expect.any(Function),
        deepTokenAddress: "0xtoken",
        suppressToasts: true,
        onStageChange: expect.any(Function),
      }),
    );
    expect(result.current.state).toEqual({ step: "success", result: serviceResult });
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
    expect(result.current.state).toEqual({ step: "success", result: { alreadyEndorsed: true } });
  });

  it("fails before contract creation when wallet, address, or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const missingSigner = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(missingSigner.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingSigner.result.current.state.step).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeEndorseFlow).not.toHaveBeenCalled();

    mocks.wallet.signer = { id: "signer" };
    mocks.wallet.address = null;

    const missingAddress = renderHook(() => useEndorseFlow());
    await act(async () => {
      await expect(missingAddress.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingAddress.result.current.state.step).toBe("error");
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
    expect(missingContract.result.current.state.step).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeEndorseFlow).not.toHaveBeenCalled();
  });
});
