import { beforeEach, describe, expect, it, vi } from "vitest";
import { addStoryChunkService } from "./addStoryChunkService";
import { sealStoryService } from "./sealStoryService";
import { createDeepFamilyInterface } from "../../../shared/clients/contractFactory";

const { createDeepFamilyContractMock } = vi.hoisted(() => ({
  createDeepFamilyContractMock: vi.fn(),
}));

vi.mock("../../../shared/clients/contractFactory", async () => {
  const actual = await vi.importActual<typeof import("../../../shared/clients/contractFactory")>(
    "../../../shared/clients/contractFactory",
  );
  return {
    ...actual,
    createDeepFamilyContract: createDeepFamilyContractMock,
  };
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("storyWriteServices", () => {
  beforeEach(() => {
    createDeepFamilyContractMock.mockReset();
  });

  it("does not locally timeout while waiting for wallet confirmation", async () => {
    vi.useFakeTimers();

    const tx = {
      hash: "0xtx",
      wait: vi.fn().mockResolvedValue({ blockNumber: 12, logs: [] }),
    };

    const deferredTx = createDeferred<typeof tx>();
    createDeepFamilyContractMock.mockReturnValue({
      addStoryChunk: vi.fn(() => deferredTx.promise),
    });

    const signer = {
      getAddress: vi.fn().mockResolvedValue("0x1234"),
    };

    let settled = "pending";
    const promise = addStoryChunkService(signer as any, "0xcontract", "1", 0, "hello", "");
    promise.then(
      () => {
        settled = "fulfilled";
      },
      () => {
        settled = "rejected";
      },
    );

    await vi.advanceTimersByTimeAsync(31_000);
    await Promise.resolve();

    expect(settled).toBe("pending");

    deferredTx.resolve(tx);
    await expect(promise).resolves.toMatchObject({
      transactionHash: "0xtx",
      blockNumber: 12,
    });
  });

  it("parses story events from the mined receipt", async () => {
    const eventInterface = createDeepFamilyInterface();
    const chunkEvent = eventInterface.getEvent("StoryChunkAdded");
    const sealEvent = eventInterface.getEvent("StorySealed");
    if (!chunkEvent || !sealEvent) {
      throw new Error("Missing story events in ABI");
    }

    const contractAddress = "0x0000000000000000000000000000000000000abc";
    const chunkLog = eventInterface.encodeEventLog(chunkEvent, [1n, 0n, "0x" + "11".repeat(32), "0x00000000000000000000000000000000000000bb", 5n, 2, "ipfs://chunk"]);
    const sealLog = eventInterface.encodeEventLog(sealEvent, [1n, 3n, "0x" + "22".repeat(32), "0x00000000000000000000000000000000000000bb"]);

    const contract = {
      addStoryChunk: vi.fn(async () => ({
        hash: "0xchunk",
        wait: vi.fn(async () => ({
          blockNumber: 20,
          logs: [{ address: contractAddress, topics: chunkLog.topics, data: chunkLog.data }],
        })),
      })),
      sealStory: vi.fn(async () => ({
        hash: "0xseal",
        wait: vi.fn(async () => ({
          blockNumber: 21,
          logs: [{ address: contractAddress, topics: sealLog.topics, data: sealLog.data }],
        })),
      })),
    };
    createDeepFamilyContractMock.mockReturnValue(contract);

    const signer = {
      getAddress: vi.fn().mockResolvedValue("0x00000000000000000000000000000000000000bb"),
    };

    const addResult = await addStoryChunkService(
      signer as any,
      contractAddress,
      "1",
      0,
      "hello",
      "",
      2,
      "ipfs://chunk",
    );
    expect(addResult.events.StoryChunkAdded?.contentLength).toBe(5);
    expect(addResult.newChunk.chunkType).toBe(2);

    const sealResult = await sealStoryService(signer as any, contractAddress, "1");
    expect(sealResult.events.StorySealed?.totalChunks).toBe(3);
    expect(sealResult.fullStoryHash).toBe("0x" + "22".repeat(32));
  });
});
