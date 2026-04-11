// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMintNftFlow } from "./useMintNftFlow";

const mocks = vi.hoisted(() => ({
  wallet: {
    signer: { id: "signer" },
    address: "0x00000000000000000000000000000000000000aa",
  } as { signer: any; address: string | null },
  config: {
    contractAddress: "0x0000000000000000000000000000000000000abc",
  },
  tx: { hash: "0xtx" },
  receipt: { transactionHash: "0xtx", blockNumber: 10 },
  contract: {
    mintPersonVersionNFT: vi.fn(),
    getVersionDetails: vi.fn(),
  },
  createDeepFamilyContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  executeMintFlow: vi.fn(),
}));

vi.mock("../../wallet/context", () => ({
  useWallet: () => mocks.wallet,
}));

vi.mock("../../config/context", () => ({
  useConfig: () => mocks.config,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../../shared/clients/contractFactory", () => ({
  createDeepFamilyContract: mocks.createDeepFamilyContract,
}));

vi.mock("../api/txGateway", () => ({
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("../services/mintNftService", () => ({
  executeMintFlow: mocks.executeMintFlow,
}));

const flowArgs = {
  personHash: "0xperson",
  versionIndex: 2,
  proofEnvelope: { proof: "ok" },
  publicSignals: {
    identityCommitment: 1n,
    disclosureBinding: 2n,
    minter: 3n,
    schemaVersion: 1,
    cryptoSuiteVersion: 1,
    hashAlgoId: 1,
  },
  tokenURI: "ipfs://token",
  coreInfo: {
    basicInfo: {
      identityCommitment: "1",
      isBirthBC: false,
      birthYear: 2000,
      birthMonth: 1,
      birthDay: 1,
      gender: 1,
    },
    supplementInfo: {
      fullName: "Test",
      birthPlace: "",
      isDeathBC: false,
      deathYear: 0,
      deathMonth: 0,
      deathDay: 0,
      deathPlace: "",
      story: "",
    },
  },
};

describe("useMintNftFlow", () => {
  beforeEach(() => {
    mocks.wallet.signer = { id: "signer" };
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.contract.mintPersonVersionNFT.mockReset();
    mocks.contract.getVersionDetails.mockReset();
    mocks.createDeepFamilyContract.mockReset();
    mocks.waitForTransactionReceipt.mockReset();
    mocks.executeMintFlow.mockReset();
    mocks.contract.mintPersonVersionNFT.mockResolvedValue(mocks.tx);
    mocks.contract.getVersionDetails.mockResolvedValue({ tokenId: 17 });
    mocks.createDeepFamilyContract.mockReturnValue(mocks.contract);
    mocks.waitForTransactionReceipt.mockResolvedValue(mocks.receipt);
  });

  it("passes contract callbacks to executeMintFlow and stores the result", async () => {
    const flowResult = {
      requiresEndorsement: false,
      receipt: mocks.receipt,
      transactionHash: "0xtx",
      blockNumber: 10,
      tokenId: 17,
      event: null,
    };
    mocks.executeMintFlow.mockImplementation(async (params) => {
      const receipt = await params.mintPersonVersionNFT(
        flowArgs.proofEnvelope,
        flowArgs.publicSignals,
        flowArgs.versionIndex,
        flowArgs.tokenURI,
        flowArgs.coreInfo,
      );
      const versionDetails = await params.getVersionDetails(flowArgs.personHash, flowArgs.versionIndex);
      expect(receipt).toBe(mocks.receipt);
      expect(versionDetails).toEqual({ tokenId: 17 });
      return flowResult;
    });

    const { result } = renderHook(() => useMintNftFlow());

    await act(async () => {
      await expect(result.current.runOrThrow(flowArgs)).resolves.toBe(flowResult);
    });

    expect(mocks.createDeepFamilyContract).toHaveBeenCalledWith(
      mocks.config.contractAddress,
      mocks.wallet.signer,
    );
    expect(mocks.contract.mintPersonVersionNFT).toHaveBeenCalledWith(
      flowArgs.proofEnvelope,
      flowArgs.publicSignals,
      flowArgs.versionIndex,
      flowArgs.tokenURI,
      flowArgs.coreInfo,
    );
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledWith(mocks.tx);
    expect(mocks.contract.getVersionDetails).toHaveBeenCalledWith(
      flowArgs.personHash,
      flowArgs.versionIndex,
    );
    expect(mocks.executeMintFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: mocks.contract,
        address: mocks.wallet.address,
        personHash: flowArgs.personHash,
        versionIndex: flowArgs.versionIndex,
        proofEnvelope: flowArgs.proofEnvelope,
        publicSignals: flowArgs.publicSignals,
        tokenURI: flowArgs.tokenURI,
        coreInfo: flowArgs.coreInfo,
        mintPersonVersionNFT: expect.any(Function),
        getVersionDetails: expect.any(Function),
      }),
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toBe(flowResult);
  });

  it("fails before contract creation when wallet, address, or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const missingSigner = renderHook(() => useMintNftFlow());
    await act(async () => {
      await expect(missingSigner.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeMintFlow).not.toHaveBeenCalled();

    mocks.wallet.signer = { id: "signer" };
    mocks.wallet.address = null;

    const missingAddress = renderHook(() => useMintNftFlow());
    await act(async () => {
      await expect(missingAddress.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeMintFlow).not.toHaveBeenCalled();

    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.config.contractAddress = "";

    const missingContract = renderHook(() => useMintNftFlow());
    await act(async () => {
      await expect(missingContract.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeMintFlow).not.toHaveBeenCalled();
  });
});
