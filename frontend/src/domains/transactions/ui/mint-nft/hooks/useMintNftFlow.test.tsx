import { ethers } from "ethers";
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
    readerAddress: "0x0000000000000000000000000000000000000def",
  },
  tx: { hash: "0xtx" },
  receipt: { transactionHash: "0xtx", blockNumber: 10 },
  contract: {
    mintPersonVersionNFT: vi.fn(),
    getVersionDetails: vi.fn(),
  },
  createDeepFamilyContract: vi.fn(),
  createDeepFamilyReaderContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  executeMintFlow: vi.fn(),
  mintBiographyTransaction: vi.fn(),
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
  createDeepFamilyReaderContract: mocks.createDeepFamilyReaderContract,
}));

vi.mock("../../../api/txGateway", () => ({
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
}));

vi.mock("../../../services/mintNftService", () => ({
  executeMintFlow: mocks.executeMintFlow,
}));

vi.mock("../../../services/mintBiographyTransaction", () => ({
  mintBiographyTransaction: mocks.mintBiographyTransaction,
}));

const flowArgs = {
  personHash: "0xperson",
  versionIndex: 2,
  selfSuiteId: 1,
  proofEnvelope: { proof: "ok" },
  publicSignals: {
    identityCommitment: 1n,
    disclosureBinding: 2n,
    minter: 3n,
    suiteCommitment: 4n,
  },
  tokenURI: "ipfs://token",
  coreInfo: {
    basicInfo: {
      identityCommitment: `0x${"01".padStart(64, "0")}`,
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function invokeMint(params: any) {
  return params.mintPersonVersionNFT(
    flowArgs.proofEnvelope,
    flowArgs.publicSignals,
    flowArgs.versionIndex,
    flowArgs.tokenURI,
    flowArgs.coreInfo,
    "0x",
    ethers.keccak256("0x"),
  );
}

describe("useMintNftFlow", () => {
  beforeEach(() => {
    mocks.wallet.signer = { id: "signer" };
    mocks.wallet.address = "0x00000000000000000000000000000000000000aa";
    mocks.config.contractAddress = "0x0000000000000000000000000000000000000abc";
    mocks.config.readerAddress = "0x0000000000000000000000000000000000000def";
    mocks.contract.mintPersonVersionNFT.mockReset();
    mocks.contract.getVersionDetails.mockReset();
    mocks.createDeepFamilyContract.mockReset();
    mocks.createDeepFamilyReaderContract.mockReset();
    mocks.waitForTransactionReceipt.mockReset();
    mocks.executeMintFlow.mockReset();
    mocks.mintBiographyTransaction.mockReset().mockResolvedValue(mocks.receipt);
    mocks.contract.mintPersonVersionNFT.mockResolvedValue(mocks.tx);
    mocks.contract.getVersionDetails.mockResolvedValue({ tokenId: 17 });
    mocks.createDeepFamilyContract.mockReturnValue(mocks.contract);
    mocks.createDeepFamilyReaderContract.mockReturnValue(mocks.contract);
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
        "0x",
        ethers.keccak256("0x"),
      );
      const versionDetails = await params.getVersionDetails(
        flowArgs.personHash,
        flowArgs.versionIndex,
      );
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
    expect(mocks.mintBiographyTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: mocks.contract,
        signer: mocks.wallet.signer,
        args: [
          flowArgs.proofEnvelope,
          flowArgs.publicSignals,
          flowArgs.versionIndex,
          flowArgs.tokenURI,
          flowArgs.coreInfo,
          "0x",
          ethers.keccak256("0x"),
        ],
        confirm: expect.any(Function),
      }),
    );
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
        selfSuiteId: flowArgs.selfSuiteId,
        proofEnvelope: flowArgs.proofEnvelope,
        publicSignals: flowArgs.publicSignals,
        tokenURI: flowArgs.tokenURI,
        coreInfo: flowArgs.coreInfo,
        mintPersonVersionNFT: expect.any(Function),
        getVersionDetails: expect.any(Function),
      }),
    );
    expect(result.current.state).toEqual({ step: "success", result: flowResult });
  });

  it("fails before contract creation when wallet, address, or contract config is missing", async () => {
    mocks.wallet.signer = null;

    const missingSigner = renderHook(() => useMintNftFlow());
    await act(async () => {
      await expect(missingSigner.result.current.runOrThrow(flowArgs)).rejects.toThrow(
        "Please connect your wallet",
      );
    });
    expect(missingSigner.result.current.state.step).toBe("error");
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
    expect(missingAddress.result.current.state.step).toBe("error");
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
    expect(missingContract.result.current.state.step).toBe("error");
    expect(mocks.createDeepFamilyContract).not.toHaveBeenCalled();
    expect(mocks.executeMintFlow).not.toHaveBeenCalled();
  });

  it.each(["reset", "unmount"] as const)(
    "does not start a mint when validation finishes after %s",
    async (cancel) => {
      const validation = deferred();
      mocks.executeMintFlow.mockImplementation(async (params) => {
        await validation.promise;
        return invokeMint(params);
      });
      const hook = renderHook(() => useMintNftFlow());
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.runOrThrow(flowArgs);
      });
      const rejected = expect(pending).rejects.toThrow(/superseded/);
      act(() => {
        if (cancel === "reset") hook.result.current.reset();
        else hook.unmount();
      });
      await act(async () => {
        validation.resolve();
        await rejected;
      });
      expect(mocks.mintBiographyTransaction).not.toHaveBeenCalled();
      expect(hook.result.current.transactionPreview).toBeNull();
    },
  );

  it.each(["reset", "unmount"] as const)(
    "rejects a delayed gas preview after %s without opening confirmation",
    async (cancel) => {
      const estimation = deferred();
      const approved = vi.fn();
      const preview = { payloadBytes: 100 };
      mocks.executeMintFlow.mockImplementation(invokeMint);
      mocks.mintBiographyTransaction.mockImplementation(async (input) => {
        await estimation.promise;
        const confirmation = await input.confirm(preview);
        approved(confirmation);
        if (!confirmation) throw new Error("Mint cancelled before wallet request");
        return mocks.receipt;
      });
      const hook = renderHook(() => useMintNftFlow());
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.runOrThrow(flowArgs);
      });
      const rejected = expect(pending).rejects.toThrow(/cancelled/);
      act(() => {
        if (cancel === "reset") hook.result.current.reset();
        else hook.unmount();
      });
      await act(async () => {
        estimation.resolve();
        await rejected;
      });
      expect(approved).toHaveBeenCalledWith(false);
      expect(hook.result.current.transactionPreview).toBeNull();
    },
  );
});
