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

const mocks = vi.hoisted(() => ({ archive: vi.fn(), receipt: vi.fn() }));
vi.mock("../../../shared/clients/contractFactory", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/clients/contractFactory")>(
    "../../../shared/clients/contractFactory",
  )),
  createArchiveContract: mocks.archive,
}));
vi.mock("../api/txGateway", async () => ({
  ...(await vi.importActual<typeof import("../api/txGateway")>("../api/txGateway")),
  waitForTransactionReceipt: mocks.receipt,
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
          encodePublicStoryRecord({ content: story, chunkType: 0, attachmentCID: "" }),
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
  const method = Object.assign(vi.fn().mockResolvedValue({ hash: txHash }), {
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
    storyState: vi
      .fn()
      .mockResolvedValue({
        totalRecords: story ? 1n : 0n,
        totalPayloadLength: BigInt(blob.payloadLength),
        recordsHead: story ? head : ethers.ZeroHash,
      }),
    storyRecordRef: vi.fn().mockResolvedValue(ref),
  };
  mocks.archive.mockReturnValue(archive);
  const signer = {
    getAddress: vi.fn().mockResolvedValue(author),
    provider: {
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
  const run = () =>
    mintBiographyTransaction({ contract, signer: signer as any, args, personHash, confirm });
  return { run, args, method, confirm, signer, archive, ref, receipt, payload };
}
describe("atomic mint biography transaction", () => {
  beforeEach(() => vi.clearAllMocks());
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
    await expect(f.run()).rejects.toThrow(/reference/);
    const g = setup();
    g.signer.provider.getCode.mockResolvedValue("0x00ff");
    await expect(g.run()).rejects.toThrow();
  });
  it("allows an empty biography without creating a record or requesting its bytes", async () => {
    const f = setup("");
    await expect(f.run()).resolves.toBe(f.receipt);
    expect(f.archive.storyRecordRef).not.toHaveBeenCalled();
    expect(f.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ payloadBytes: 0, segmentCount: 0 }),
    );
  });
});
