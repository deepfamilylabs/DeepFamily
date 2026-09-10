import { beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import {
  computeStoryRecordHash,
  computeStoryHead,
  encodeStoryRecord,
  STORY_CHUNK_SCHEMA_ID,
} from "@deepfamily/protocol-core";
import { addStoryChunkService } from "./addStoryChunkService";
import { sealStoryService } from "./sealStoryService";
import { createArchiveInterface } from "../../../shared/clients/contractFactory";
const mocks = vi.hoisted(() => ({ main: vi.fn(), archive: vi.fn() }));
vi.mock("../../../shared/clients/contractFactory", async () => ({
  ...(await vi.importActual<typeof import("../../../shared/clients/contractFactory")>(
    "../../../shared/clients/contractFactory",
  )),
  createDeepFamilyContract: mocks.main,
  createArchiveContract: mocks.archive,
}));
const ADDRESS = "0x0000000000000000000000000000000000000aBc";
const AUTHOR = "0x00000000000000000000000000000000000000bb";
const POINTER = "0x00000000000000000000000000000000000000cc";
const iface = createArchiveInterface();
function setup() {
  let state = {
    recordsHead: ethers.ZeroHash,
    totalRecords: 0n,
    totalPayloadLength: 0n,
    lastUpdateTime: 0n,
    isSealed: false,
  };
  let ref: any;
  const log = (name: string, values: unknown[]) => ({
    address: ADDRESS,
    ...iface.encodeEventLog(iface.getEvent(name)!, values),
  });
  const append = Object.assign(
    vi.fn(async (...args: any[]) => {
      const [tokenId, index, previousHead, schemaId, payload, payloadHash] = args;
      const blob = {
        pointer: POINTER,
        payloadHash,
        payloadLength: BigInt(ethers.getBytes(payload).length),
        segmentCount: BigInt(Math.ceil(ethers.getBytes(payload).length / 16384)),
      };
      ref = { blob, schemaId, author: AUTHOR, timestamp: 100n };
      const recordHash = computeStoryRecordHash({
        chainId: 31337n,
        archive: ADDRESS,
        tokenId,
        index,
        schemaId,
        payloadHash,
        payloadLength: blob.payloadLength,
        author: AUTHOR,
        timestamp: 100n,
      });
      const head = computeStoryHead({ previousHead, recordHash });
      state = {
        recordsHead: head,
        totalRecords: BigInt(index) + 1n,
        totalPayloadLength: blob.payloadLength,
        lastUpdateTime: 100n,
        isSealed: false,
      };
      return {
        hash: "0xappend",
        wait: vi.fn(async () => ({
          status: 1,
          hash: "0xappend",
          blockNumber: 12,
          logs: [
            log("StoryRecordAppended", [
              tokenId,
              index,
              blob,
              schemaId,
              AUTHOR,
              100n,
              recordHash,
              head,
            ]),
          ],
        })),
      };
    }),
    { estimateGas: vi.fn(async () => 1001n), staticCall: vi.fn(async () => {}) },
  );
  const seal = Object.assign(
    vi.fn(async (tokenId: string) => {
      state = { ...state, isSealed: true, lastUpdateTime: 101n };
      return {
        hash: "0xseal",
        wait: vi.fn(async () => ({
          status: 1,
          hash: "0xseal",
          blockNumber: 13,
          logs: [
            log("StorySealed", [
              tokenId,
              state.totalRecords,
              state.recordsHead,
              state.totalPayloadLength,
              AUTHOR,
              101n,
            ]),
          ],
        })),
      };
    }),
    { estimateGas: vi.fn(async () => 1000n) },
  );
  const archive = {
    interface: iface,
    appendStoryRecord: append,
    sealStory: seal,
    storyState: vi.fn(async () => ({ ...state })),
    storyRecordRef: vi.fn(async () => ref),
  };
  const signer = {
    getAddress: vi.fn(async () => AUTHOR),
    provider: {
      getNetwork: vi.fn(async () => ({ chainId: 31337n })),
      getBlock: vi.fn(async () => ({ gasLimit: 30000000n })),
      getFeeData: vi.fn(async () => ({ gasPrice: 1n, maxFeePerGas: 2n })),
    },
  };
  mocks.main.mockReturnValue({ archive: vi.fn(async () => ADDRESS) });
  mocks.archive.mockReturnValue(archive);
  const confirm = vi.fn(async () => true);
  const submit = (content = "  原文\n🙂  ") =>
    addStoryChunkService(signer as any, ADDRESS, "1", 0, content, "", 2, "", confirm);
  return { archive, signer, confirm, submit };
}
describe("Archive story writes", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  it("previews and submits exact canonical bytes with integer-ceiling gas and reconciles refs", async () => {
    const f = setup();
    const result = await f.submit();
    const bytes = ethers.hexlify(
      encodeStoryRecord({ content: "  原文\n🙂  ", chunkType: 2, attachmentCID: "" }),
    );
    expect(f.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalPayload: bytes, gasLimit: 1202n, segmentCount: 1 }),
    );
    expect(f.archive.appendStoryRecord).toHaveBeenCalledWith(
      "1",
      0,
      ethers.ZeroHash,
      STORY_CHUNK_SCHEMA_ID,
      bytes,
      ethers.keccak256(bytes),
      { gasLimit: 1202n },
    );
    expect(result.newChunk.content).toBe("  原文\n🙂  ");
    expect(result.newChunk.recordHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("rejects estimate failure even when staticCall succeeds and never requests signature", async () => {
    const f = setup();
    f.archive.appendStoryRecord.estimateGas.mockRejectedValue(new Error("RPC unavailable"));
    await expect(f.submit()).rejects.toThrow(/estimat/i);
    expect(f.archive.appendStoryRecord).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it("compresses a long original and previews the actual stored byte length", async () => {
    const f = setup();
    const content = "长传记 😀\n".repeat(4000);
    const bytes = encodeStoryRecord({ content, chunkType: 2, attachmentCID: "" });
    const result = await f.submit(content);
    expect(result.contentLength).toBe(bytes.length);
    expect(bytes.length).toBeLessThan(16384);
    expect(f.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ payloadBytes: bytes.length, segmentCount: 1 }),
    );
    expect(result.newChunk.content).toBe(content);
  });

  it("rejects buffered transaction cap overflow", async () => {
    const f = setup();
    f.signer.provider.getNetwork.mockResolvedValue({ chainId: 1n });
    f.archive.appendStoryRecord.estimateGas.mockResolvedValue(14000000n);
    await expect(f.submit()).rejects.toThrow(/limit/i);
    expect(f.archive.appendStoryRecord).not.toHaveBeenCalled();
  });
  it("does not send after preview cancellation", async () => {
    const f = setup();
    f.confirm.mockResolvedValue(false);
    await expect(f.submit()).rejects.toThrow(/cancel/i);
    expect(f.archive.appendStoryRecord).not.toHaveBeenCalled();
  });
  it("does not locally timeout while awaiting wallet confirmation", async () => {
    vi.useFakeTimers();
    const f = setup();
    const original = f.archive.appendStoryRecord.getMockImplementation()!;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.archive.appendStoryRecord.mockImplementation(async (...args: any[]) => {
      await wait;
      return original(...args);
    });
    let settled = false;
    const promise = f.submit().finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(31000);
    expect(settled).toBe(false);
    release();
    await expect(promise).resolves.toMatchObject({ transactionHash: "0xappend" });
  });
  it("fails receipt reconciliation on an altered stored ref", async () => {
    const f = setup();
    f.archive.storyRecordRef.mockResolvedValue({
      blob: { pointer: POINTER, payloadHash: ethers.ZeroHash, payloadLength: 1n, segmentCount: 1n },
    });
    await expect(f.submit()).rejects.toThrow(/reference|payload/i);
  });
  it("seals the exact count/head and validates event and final state", async () => {
    const f = setup();
    const added = await f.submit();
    const sealed = await sealStoryService(f.signer as any, ADDRESS, "1", f.confirm);
    expect(f.archive.sealStory).toHaveBeenCalledWith("1", 1n, added.recordsHead, {
      gasLimit: 1200n,
    });
    expect(sealed.events.StorySealed.totalChunks).toBe(1);
    expect(sealed.fullStoryHash).toBe(added.recordsHead);
  });
  it("stops sealing before the wallet if gas estimation fails", async () => {
    const f = setup();
    await f.submit();
    f.confirm.mockClear();
    f.archive.sealStory.estimateGas.mockRejectedValue(new Error("RPC unavailable"));
    await expect(sealStoryService(f.signer as any, ADDRESS, "1", f.confirm)).rejects.toThrow(
      /estimat/i,
    );
    expect(f.archive.sealStory).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it("stops sealing when the gas preview is cancelled", async () => {
    const f = setup();
    await f.submit();
    f.confirm.mockResolvedValue(false);
    await expect(sealStoryService(f.signer as any, ADDRESS, "1", f.confirm)).rejects.toThrow(
      /cancel/i,
    );
    expect(f.archive.sealStory).not.toHaveBeenCalled();
  });
  it("stops sealing if the wallet changes account during the preview", async () => {
    const f = setup();
    await f.submit();
    f.confirm.mockImplementation(async () => {
      f.signer.getAddress.mockResolvedValue(POINTER);
      return true;
    });
    await expect(sealStoryService(f.signer as any, ADDRESS, "1", f.confirm)).rejects.toThrow(
      /account changed/i,
    );
    expect(f.archive.sealStory).not.toHaveBeenCalled();
  });
});
