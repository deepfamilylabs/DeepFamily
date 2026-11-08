import { beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import {
  computeStoryHead,
  computeStoryRecordHash,
  STORY_BIOGRAPHY_SCHEMA_ID,
} from "@deepfamily/protocol-core";
import { encodePublicStoryRecord } from "../../../shared/config/storyEncoding";
import {
  createArchiveInterface,
  createDeepFamilyInterface,
} from "../../../shared/clients/contractFactory";
import { mintBiographyTransaction } from "./mintBiographyTransaction";
import { contractFeeReplacement } from "../test-helpers/contractReplacement";

const mocks = vi.hoisted(() => ({ archive: vi.fn(), receipt: vi.fn() }));
vi.mock("../../../shared/clients/contractFactory", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/clients/contractFactory")>(
    "../../../shared/clients/contractFactory",
  )),
  createArchiveContract: mocks.archive,
}));
const author = "0x1111111111111111111111111111111111111111";
const main = "0x2222222222222222222222222222222222222222";
const archiveAddress = "0x3333333333333333333333333333333333333333";
const pointer = "0x4444444444444444444444444444444444444444";
const personHash = ethers.id("person");
const txHash = ethers.id("mint tx");
function setup(story = "  私密传记导入\r\n😀 e\u0301  ".repeat(100)) {
  const payload =
    story === ""
      ? "0x"
      : ethers.hexlify(
          encodePublicStoryRecord({ title: "", content: story, recordType: 0, attachmentURI: "" }),
        );
  const blob = {
    pointer,
    payloadHash: ethers.keccak256(payload),
    payloadLength: ethers.getBytes(payload).length,
    segmentCount: Math.ceil(ethers.getBytes(payload).length / 16384),
  };
  const ref = { blob, schemaId: STORY_BIOGRAPHY_SCHEMA_ID, author, timestamp: 100 };
  const recordHash = computeStoryRecordHash({
    chainId: 31337,
    archive: archiveAddress,
    tokenId: 1,
    index: 0,
    schemaId: ref.schemaId,
    payloadHash: blob.payloadHash,
    payloadLength: blob.payloadLength,
    author,
    timestamp: 100,
  });
  const head = computeStoryHead({ previousHead: ethers.ZeroHash, recordHash });
  const mainInterface = createDeepFamilyInterface();
  const archiveInterface = createArchiveInterface();
  const mintEvent = mainInterface.encodeEventLog(mainInterface.getEvent("PersonNFTMinted")!, [
    personHash,
    1,
    author,
    1,
    "",
    100,
  ]);
  const storyEvent = archiveInterface.encodeEventLog(
    archiveInterface.getEvent("StoryRecordAppended")!,
    [1, 0, blob, ref.schemaId, author, 100, recordHash, head],
  );
  const receipt = {
    status: 1,
    hash: txHash,
    blockNumber: 10,
    logs: [
      { address: main, ...mintEvent },
      ...(story ? [{ address: archiveAddress, ...storyEvent }] : []),
    ],
  };
  mocks.receipt.mockResolvedValue(receipt);
  const method = Object.assign(vi.fn().mockResolvedValue({ replaceableTransaction() { return this; }, hash: txHash, nonce: 1, wait: mocks.receipt }), {
    estimateGas: vi.fn().mockResolvedValue(101n),
    staticCall: vi.fn().mockResolvedValue(undefined),
  });
  const contract = {
    mintPersonVersionNFT: method,
    interface: mainInterface,
    getAddress: vi.fn().mockResolvedValue(main),
    archive: vi.fn().mockResolvedValue(archiveAddress),
  };
  const archive = {
    storyState: vi.fn().mockResolvedValue({
      totalRecords: story ? 1n : 0n,
      totalPayloadLength: BigInt(blob.payloadLength),
      recordsHead: story ? head : ethers.ZeroHash,
    }),
    storyRecordRef: vi.fn().mockResolvedValue(ref),
  };
  mocks.archive.mockReturnValue(archive);
  const signer = {
    getAddress: vi.fn().mockResolvedValue(author),
    provider: { getBlockNumber: async () => 12,
      getNetwork: vi.fn().mockResolvedValue({ chainId: 31337n }),
      getBlock: vi.fn().mockResolvedValue({ gasLimit: 30_000_000n }),
      getFeeData: vi.fn().mockResolvedValue({ gasPrice: 1n, maxFeePerGas: 2n }),
      getCode: vi.fn().mockResolvedValue(`0x00${payload.slice(2)}`),
    },
  };
  const args: any[] = [
    { circuitId: 1, proofEncodingId: 1, proofData: "0x" },
    { identityCommitment: 1n, disclosureBinding: 2n, minter: BigInt(author), suiteCommitment: 3n },
    1,
    "",
    {
      basicInfo: {
        identityCommitment: ethers.id("id"),
        isBirthBC: false,
        birthYear: 1900,
        birthMonth: 1,
        birthDay: 1,
        gender: 1,
      },
      supplementInfo: {
        fullName: "Original Name",
        birthPlace: "",
        isDeathBC: false,
        deathYear: 0,
        deathMonth: 0,
        deathDay: 0,
        deathPlace: "",
      },
    },
    payload,
    blob.payloadHash,
  ];
  const confirm = vi.fn().mockResolvedValue(true);
  const run = (overrides: Partial<Parameters<typeof mintBiographyTransaction>[0]> = {}) =>
    mintBiographyTransaction({ contract, signer: signer as any, args, personHash, confirm, ...overrides });
  return { run, args, method, confirm, signer, archive, ref, receipt, payload, contract };
}
describe("atomic mint biography transaction", () => {
  beforeEach(() => vi.clearAllMocks());
  it("discovers a fee replacement through the real ethers contract response", async () => {
    const f = setup();
    const tracked = contractFeeReplacement({eventInterface: f.contract.interface,
      receipt: f.receipt, from: author, to: main,
      data: f.contract.interface.encodeFunctionData("mintPersonVersionNFT", f.args)});
    f.method.mockResolvedValue(tracked.transaction);
    const receipt = await f.run();
    expect(tracked.wasScanned()).toBe(true);
    expect(receipt.hash).toBe(tracked.transactionHash);
  }, 1500);
  it("previews the complete mint, freezes nested fields, verifies compressed readback and preserves all text", async () => {
    const f = setup();
    f.confirm.mockImplementation(async () => {
      f.args[4].supplementInfo.fullName = "Edited during preview";
      return true;
    });
    await expect(f.run()).resolves.toBe(f.receipt);
    expect(f.method.estimateGas).toHaveBeenCalledTimes(1);
    expect(f.method.mock.calls[0][4].supplementInfo.fullName).toBe("Original Name");
    expect(f.method.mock.calls[0][5]).toBe(f.payload);
    expect(f.method.mock.calls[0][7]).toEqual({ gasLimit: 122n });
    expect(f.signer.provider.getCode).toHaveBeenCalledWith(pointer, 10);
  });
  it("does not submit on preview cancellation or failed full-call estimation", async () => {
    const f = setup();
    f.confirm.mockResolvedValue(false);
    await expect(f.run()).rejects.toThrow(/cancelled/);
    expect(f.method).not.toHaveBeenCalled();
    f.method.estimateGas.mockRejectedValue(new Error("RPC failed"));
    await expect(f.run()).rejects.toThrow(/estimation/);
    expect(f.method).not.toHaveBeenCalled();
  });
  it("rejects a network change after approval", async () => {
    const f = setup();
    f.confirm.mockImplementation(async () => {
      f.signer.provider.getNetwork.mockResolvedValue({ chainId: 1n });
      return true;
    });
    await expect(f.run()).rejects.toThrow(/changed/);
    expect(f.method).not.toHaveBeenCalled();
  });
  it("rejects a stored reference or data runtime different from the confirmed payload", async () => {
    const f = setup();
    f.ref.author = main;
    await expect(f.run()).rejects.toMatchObject({
      message: expect.stringMatching(/reference/),
      transactionHash: txHash,
      transactionConfirmed: true,
      verificationFailure: "mismatch",
    });
    const g = setup();
    g.signer.provider.getCode.mockResolvedValue("0x00ff");
    await expect(g.run()).rejects.toMatchObject({
      transactionHash: txHash,
      transactionConfirmed: true,
      verificationFailure: "mismatch",
    });
  });
  it("allows an empty biography without creating a record or requesting its bytes", async () => {
    const f = setup("");
    await expect(f.run()).resolves.toBe(f.receipt);
    expect(f.archive.storyRecordRef).not.toHaveBeenCalled();
    expect(f.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ payloadBytes: 0, segmentCount: 0 }),
    );
  });

  it("does not request the wallet after cancellation during the last network check", async () => {
    const f = setup();
    let resolveNetwork!: (value: { chainId: bigint }) => void;
    let active = true;
    let checkingFinalNetwork = false;
    const finalNetwork = new Promise<{ chainId: bigint }>((resolve) => { resolveNetwork = resolve; });
    f.confirm.mockImplementation(async () => {
      f.signer.provider.getNetwork.mockImplementationOnce(() => {
        checkingFinalNetwork = true;
        return finalNetwork;
      });
      return true;
    });
    const assertActive = () => { if (!active) throw new Error("cancelled"); };
    const pending = f.run({ assertActive });
    await vi.waitFor(() => expect(checkingFinalNetwork).toBe(true));
    // The last network RPC is still pending; the wallet has not been requested.
    active = false;
    resolveNetwork({ chainId: 31337n });
    await expect(pending).rejects.toThrow("cancelled");
    expect(f.method).not.toHaveBeenCalled();
  });

  it("uses the original fixed RPC for readback after the wallet changes network", async () => {
    const f = setup();
    const readbackProvider = { getBlockNumber: async () => 12,
      getNetwork: vi.fn(async () => ({ chainId: 31337n })),
      getCode: vi.fn(async () => `0x00${f.payload.slice(2)}`),
    };
    mocks.receipt.mockImplementationOnce(async () => {
      f.signer.provider.getNetwork.mockRejectedValue(new Error("Wallet network changed"));
      f.signer.provider.getCode.mockRejectedValue(new Error("Wallet network changed"));
      return f.receipt;
    });
    await expect(f.run({ readbackProvider: readbackProvider as any })).resolves.toBe(f.receipt);
    expect(mocks.archive).toHaveBeenCalledWith(archiveAddress, readbackProvider);
    expect(readbackProvider.getCode).toHaveBeenCalledWith(pointer, 10);
    expect(f.signer.provider.getCode).not.toHaveBeenCalled();
  });

  it("rejects a verification RPC on a different chain before sending", async () => {
    const f = setup();
    await expect(f.run({ readbackProvider: { getBlockNumber: async () => 12,
      getNetwork: vi.fn(async () => ({ chainId: 1n })),
    } as any })).rejects.toThrow(/different network/);
    expect(f.method).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
  });

  it.each(["state", "reference", "code"] as const)(
    "classifies an unavailable %s read separately from a data mismatch",
    async (read) => {
      const f = setup();
      const error = Object.assign(new Error("RPC unavailable"), { code: "NETWORK_ERROR" });
      if (read === "state") f.archive.storyState.mockRejectedValueOnce(error);
      else if (read === "reference") f.archive.storyRecordRef.mockRejectedValueOnce(error);
      else f.signer.provider.getCode.mockRejectedValueOnce(error);
      const onSubmitted = vi.fn();
      const failure = await f.run({ onSubmitted }).catch((cause) => cause);
      expect(failure).toMatchObject({
        transactionHash: txHash,
        transactionConfirmed: true,
        verificationFailure: "read",
      });
      if (read === "code") {
        expect(failure).toMatchObject({ code: "ARCHIVE_CODE_READ_FAILED", cause: error });
      } else {
        expect(failure).toBe(error);
      }
      expect(onSubmitted).toHaveBeenCalledWith(txHash);
    },
  );

  it("classifies a returned commitment mismatch as validation failure", async () => {
    const f = setup();
    f.archive.storyState.mockResolvedValueOnce({
      totalRecords: 1n,
      totalPayloadLength: BigInt(ethers.getBytes(f.payload).length),
      recordsHead: ethers.ZeroHash,
    });
    await expect(f.run()).rejects.toMatchObject({
      message: expect.stringMatching(/commitment/),
      transactionHash: txHash,
      transactionConfirmed: true,
      verificationFailure: "mismatch",
    });
  });

  it("does not mark a mismatched mint receipt as a confirmed detail failure", async () => {
    const f = setup();
    f.receipt.logs.splice(0, 1);
    const error = await f.run().catch((cause) => cause);
    expect(error).toMatchObject({
      transactionHash: txHash,
      transactionConfirmed: false,
    });
    expect(error).not.toHaveProperty("verificationFailure");
    expect(f.archive.storyState).not.toHaveBeenCalled();
  });

  it("verifies a successful fee replacement with its actual hash", async () => {
    const f = setup();
    const hash = ethers.id("repriced mint");
    const receipt = { ...f.receipt, hash };
    mocks.receipt.mockRejectedValueOnce({
      code: "TRANSACTION_REPLACED",
      reason: "repriced",
      cancelled: false,
      replacement: {
        hash, nonce: 1, chainId: 31337n, from: author, to: main, value: 0n,
        data: f.contract.interface.encodeFunctionData("mintPersonVersionNFT", f.args),
      },
      receipt,
    });
    const onSubmitted = vi.fn();
    await expect(f.run({ onSubmitted })).resolves.toBe(receipt);
    expect(onSubmitted.mock.calls).toEqual([[txHash], [hash]]);
    expect(f.archive.storyState).toHaveBeenCalledOnce();
  });

  it("does not accept a successful replacement with different mint calldata", async () => {
    const f = setup();
    const hash = ethers.id("different mint");
    mocks.receipt.mockRejectedValueOnce({
      code: "TRANSACTION_REPLACED", reason: "repriced", cancelled: false,
      replacement: { hash, nonce: 1, chainId: 31337n, from: author, to: main, value: 0n, data: "0x" },
      receipt: { ...f.receipt, hash },
    });
    await expect(f.run()).rejects.toMatchObject({
      code: "TRANSACTION_REPLACEMENT_MISMATCH",
      transactionHash: txHash,
    });
    expect(f.archive.storyState).not.toHaveBeenCalled();
  });
});
