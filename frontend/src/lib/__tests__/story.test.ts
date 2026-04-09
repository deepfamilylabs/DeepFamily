import { beforeEach, describe, expect, it, vi } from "vitest";

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

const contractState = {
  addStoryChunk: vi.fn(),
  sealStory: vi.fn(),
  interface: {
    parseLog: vi.fn(),
    parseError: vi.fn(),
  },
};

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return {
    ...actual,
    Contract: vi.fn(() => contractState),
  };
});

import { addStoryChunk } from "../story";

describe("story", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    contractState.interface.parseLog.mockReturnValue(null);
  });

  it("does not locally timeout while waiting for wallet confirmation", async () => {
    const tx = {
      hash: "0xtx",
      wait: vi.fn().mockResolvedValue({ blockNumber: 12, logs: [] }),
    };

    const deferredTx = createDeferred<typeof tx>();
    contractState.addStoryChunk.mockImplementation(() => deferredTx.promise);

    const signer = {
      getAddress: vi.fn().mockResolvedValue("0x1234"),
    };

    let settled = "pending";
    const promise = addStoryChunk(signer as any, "0xcontract", "1", 0, "hello", "");
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
    expect(contractState.addStoryChunk).toHaveBeenCalledTimes(1);

    deferredTx.resolve(tx);
    await expect(promise).resolves.toMatchObject({
      transactionHash: "0xtx",
      blockNumber: 12,
    });
  });
});
