import type { Provider } from "ethers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShieldedPageModules } from "../model/shieldedPageTypes";
import {
  readShieldedSubmissionOutcome,
  type ShieldedSubmissionTracking,
} from "./shieldedSubmissionTracking";

const SIGNER_ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const REPLACEMENT_HASH = `0x${"cd".repeat(32)}`;

function fixture() {
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 71n })),
    getBlockNumber: vi.fn(async () => 90),
    getTransactionCount: vi.fn(async () => 7),
    getTransactionReceipt: vi.fn<() => Promise<{ status: number | null } | null>>(async () => null),
  };
  const noteFilter = vi.fn(() => "all-public-notes");
  const queryFilter =
    vi.fn<(filter: unknown, fromBlock: number, toBlock: number) => Promise<unknown[]>>(
      async () => [],
    );
  const tracked: ShieldedSubmissionTracking = {
    provider: provider as unknown as Provider,
    chainId: 71n,
    nonce: 7,
    signerAddress: SIGNER_ADDRESS,
    fromBlock: 80,
    pool: {
      queryFilter,
      filters: { NoteAppended: noteFilter },
    } as unknown as ShieldedPageModules["pool"],
    outputCommitments: ["100", "101"],
  };
  return { provider, noteFilter, queryFilter, tracked };
}

describe("shielded public submission tracking", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([null, { status: null }])(
    "keeps a known hash pending after checking replacement evidence: %j",
    async (receipt) => {
      const f = fixture();
      f.tracked.hash = HASH;
      f.provider.getTransactionReceipt.mockResolvedValue(receipt);

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
        status: "pending",
        hash: HASH,
      });
      expect(f.provider.getTransactionReceipt).toHaveBeenCalledWith(HASH);
      expect(f.provider.getTransactionReceipt).toHaveBeenCalledOnce();
      expect(f.queryFilter).toHaveBeenCalledExactlyOnceWith("all-public-notes", 80, 90);
      expect(f.provider.getTransactionCount).toHaveBeenCalledExactlyOnceWith(SIGNER_ADDRESS, 90);
    },
  );

  it.each([1, 0])("reports a known transaction's receipt status %i", async (receiptStatus) => {
    const f = fixture();
    f.tracked.hash = HASH;
    f.provider.getTransactionReceipt.mockResolvedValue({ status: receiptStatus });

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "confirmed",
      hash: HASH,
      receiptStatus,
    });
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.provider.getBlockNumber).not.toHaveBeenCalled();
    expect(f.queryFilter).not.toHaveBeenCalled();
  });

  it("recovers a successful speed-up from public outputs when the original hash has no receipt", async () => {
    const f = fixture();
    f.tracked.hash = HASH;
    f.provider.getTransactionCount.mockResolvedValue(8);
    f.queryFilter.mockResolvedValue([
      { args: { commitment: 100n }, transactionHash: REPLACEMENT_HASH },
      { args: { commitment: 101n }, transactionHash: REPLACEMENT_HASH },
    ]);
    f.provider.getTransactionReceipt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 1 });

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "confirmed",
      hash: REPLACEMENT_HASH,
      receiptStatus: 1,
    });
    expect(f.provider.getTransactionReceipt).toHaveBeenNthCalledWith(1, HASH);
    expect(f.provider.getTransactionReceipt).toHaveBeenNthCalledWith(2, REPLACEMENT_HASH);
    expect(f.noteFilter).toHaveBeenCalledExactlyOnceWith();
    expect(f.queryFilter).toHaveBeenCalledExactlyOnceWith("all-public-notes", 80, 90);
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.tracked.hash).toBe(HASH);
  });

  it("recovers outputs beyond a chunk boundary when the RPC caps log ranges", async () => {
    vi.stubEnv("VITE_DF_EVENT_BLOCK_CHUNK", "10");
    const f = fixture();
    f.tracked.hash = HASH;
    f.provider.getBlockNumber.mockResolvedValue(105);
    f.provider.getTransactionCount.mockResolvedValue(8);
    f.queryFilter.mockImplementation(async (_filter, fromBlock, toBlock) => {
      if (toBlock - fromBlock + 1 > 10) throw new Error("RPC log range exceeded");
      return fromBlock === 100
        ? [
            { args: { commitment: 100n }, transactionHash: REPLACEMENT_HASH },
            { args: { commitment: 101n }, transactionHash: REPLACEMENT_HASH },
          ]
        : [{ args: { commitment: 999n }, transactionHash: HASH }];
    });
    f.provider.getTransactionReceipt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 1 });

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "confirmed",
      hash: REPLACEMENT_HASH,
      receiptStatus: 1,
    });
    expect(f.queryFilter.mock.calls).toEqual([
      ["all-public-notes", 80, 89],
      ["all-public-notes", 90, 99],
      ["all-public-notes", 100, 105],
    ]);
    expect(f.noteFilter).toHaveBeenCalledExactlyOnceWith();
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.tracked.fromBlock).toBe(80);
    expect(f.tracked.hash).toBe(HASH);
  });

  it.each([undefined, HASH])(
    "checks a consumed nonce only after the complete chunked history: %s",
    async (hash) => {
      vi.stubEnv("VITE_DF_EVENT_BLOCK_CHUNK", "10");
      const f = fixture();
      if (hash) f.tracked.hash = hash;
      f.provider.getBlockNumber.mockResolvedValue(105);
      f.provider.getTransactionCount.mockResolvedValue(8);
      f.queryFilter.mockImplementation(async (_filter, fromBlock, toBlock) => {
        if (toBlock - fromBlock + 1 > 10) throw new Error("RPC log range exceeded");
        return [];
      });

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "replaced" });
      expect(f.queryFilter.mock.calls).toEqual([
        ["all-public-notes", 80, 89],
        ["all-public-notes", 90, 99],
        ["all-public-notes", 100, 105],
      ]);
      expect(f.provider.getTransactionCount).toHaveBeenCalledExactlyOnceWith(SIGNER_ADDRESS, 105);
      expect(f.queryFilter.mock.invocationCallOrder[2]).toBeLessThan(
        f.provider.getTransactionCount.mock.invocationCallOrder[0],
      );
    },
  );

  it("does not combine partial outputs from different transactions across chunks", async () => {
    vi.stubEnv("VITE_DF_EVENT_BLOCK_CHUNK", "10");
    const f = fixture();
    f.provider.getBlockNumber.mockResolvedValue(105);
    f.queryFilter.mockImplementation(async (_filter, fromBlock) =>
      fromBlock === 80
        ? [{ args: { commitment: 100n }, transactionHash: HASH }]
        : [{ args: { commitment: 101n }, transactionHash: REPLACEMENT_HASH }],
    );

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "pending" });
    expect(f.queryFilter).toHaveBeenCalledTimes(3);
    expect(f.provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(f.provider.getTransactionCount).toHaveBeenCalledExactlyOnceWith(SIGNER_ADDRESS, 105);
  });

  it("does not infer cancellation when an intermediate history chunk fails", async () => {
    vi.stubEnv("VITE_DF_EVENT_BLOCK_CHUNK", "10");
    const f = fixture();
    const failure = new Error("RPC unavailable for middle chunk");
    f.provider.getBlockNumber.mockResolvedValue(105);
    f.provider.getTransactionCount.mockResolvedValue(8);
    f.queryFilter.mockImplementation(async (_filter, fromBlock) => {
      if (fromBlock === 90) throw failure;
      return [{ args: { commitment: 100n }, transactionHash: HASH }];
    });

    await expect(readShieldedSubmissionOutcome(f.tracked)).rejects.toBe(failure);
    expect(f.queryFilter.mock.calls).toEqual([
      ["all-public-notes", 80, 89],
      ["all-public-notes", 90, 99],
    ]);
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(f.tracked.fromBlock).toBe(80);
    expect(f.tracked.hash).toBeUndefined();
  });

  it.each([null, { status: null }])(
    "keeps a discovered replacement pending while its receipt is unavailable: %j",
    async (receipt) => {
      const f = fixture();
      f.tracked.hash = HASH;
      f.provider.getTransactionCount.mockResolvedValue(8);
      f.queryFilter.mockResolvedValue([
        { args: { commitment: 100n }, transactionHash: REPLACEMENT_HASH },
        { args: { commitment: 101n }, transactionHash: REPLACEMENT_HASH },
      ]);
      f.provider.getTransactionReceipt.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
        status: "pending",
        hash: REPLACEMENT_HASH,
      });
      expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    },
  );

  it("keeps the original hash pending when its outputs exist but its receipt is temporarily missing", async () => {
    const f = fixture();
    f.tracked.hash = HASH;
    f.provider.getTransactionCount.mockResolvedValue(8);
    f.queryFilter.mockResolvedValue([
      { args: { commitment: 100n }, transactionHash: HASH },
      { args: { commitment: 101n }, transactionHash: HASH },
    ]);

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "pending",
      hash: HASH,
    });
    expect(f.provider.getTransactionReceipt).toHaveBeenCalledExactlyOnceWith(HASH);
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
  });

  it.each([undefined, HASH])("keeps tracking pending on the wrong network: %s", async (hash) => {
    const f = fixture();
    if (hash) f.tracked.hash = hash;
    f.provider.getNetwork.mockResolvedValue({ chainId: 72n });

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "pending",
      ...(hash ? { hash } : {}),
    });
    expect(f.provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(f.provider.getBlockNumber).not.toHaveBeenCalled();
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    expect(f.queryFilter).not.toHaveBeenCalled();
  });

  it("finds an unknown hash by matching all outputs from one transaction locally", async () => {
    const f = fixture();
    f.queryFilter.mockResolvedValue([
      { transactionHash: "0xplain-log" },
      { args: { commitment: 999n }, transactionHash: "0xunrelated" },
      { args: { commitment: 100n }, transactionHash: HASH },
      { args: { commitment: 101n }, transactionHash: HASH },
    ]);
    f.provider.getTransactionReceipt.mockResolvedValue({ status: 1 });

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "confirmed",
      hash: HASH,
      receiptStatus: 1,
    });
    expect(f.noteFilter).toHaveBeenCalledExactlyOnceWith();
    expect(f.queryFilter).toHaveBeenCalledExactlyOnceWith("all-public-notes", 80, 90);
    expect(f.provider.getTransactionReceipt).toHaveBeenCalledWith(HASH);
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
  });

  it("returns a discovered hash while its receipt is still pending", async () => {
    const f = fixture();
    f.queryFilter.mockResolvedValue([
      { args: { commitment: 100n }, transactionHash: HASH },
      { args: { commitment: 101n }, transactionHash: HASH },
    ]);

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
      status: "pending",
      hash: HASH,
    });
    expect(f.tracked.hash).toBeUndefined();
    expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
  });

  it("does not combine outputs from different transactions", async () => {
    const f = fixture();
    f.queryFilter.mockResolvedValue([
      { args: { commitment: 100n }, transactionHash: "0xfirst" },
      { args: { commitment: 101n }, transactionHash: "0xsecond" },
    ]);

    expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "pending" });
    expect(f.provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(f.provider.getTransactionCount).toHaveBeenCalledExactlyOnceWith(SIGNER_ADDRESS, 90);
  });

  it.each([6, 7])(
    "keeps an unknown submission pending while nonce %i has not consumed its nonce",
    async (nonce) => {
      const f = fixture();
      f.provider.getTransactionCount.mockResolvedValue(nonce);

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "pending" });
      expect(f.provider.getTransactionCount).toHaveBeenCalledExactlyOnceWith(SIGNER_ADDRESS, 90);
    },
  );

  it.each([undefined, HASH])(
    "reports a consumed nonce only after checking public outputs at the same block: %s",
    async (hash) => {
      const f = fixture();
      if (hash) f.tracked.hash = hash;
      f.provider.getTransactionCount.mockResolvedValue(8);

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "replaced" });
      expect(f.queryFilter).toHaveBeenCalledWith("all-public-notes", 80, 90);
      expect(f.provider.getTransactionCount).toHaveBeenCalledWith(SIGNER_ADDRESS, 90);
      expect(f.provider.getBlockNumber).toHaveBeenCalledOnce();
      expect(f.queryFilter.mock.invocationCallOrder[0]).toBeLessThan(
        f.provider.getTransactionCount.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([undefined, HASH])(
    "checks an approval's nonce without querying pool events: %s",
    async (hash) => {
      const f = fixture();
      if (hash) f.tracked.hash = hash;
      delete f.tracked.pool;
      delete f.tracked.outputCommitments;
      f.provider.getTransactionCount.mockResolvedValue(8);

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "replaced" });
      expect(f.queryFilter).not.toHaveBeenCalled();
      expect(f.provider.getTransactionCount).toHaveBeenCalledWith(SIGNER_ADDRESS, 90);
    },
  );

  it.each(["nonce", "signerAddress"] as const)(
    "cannot classify an unknown submission without %s",
    async (missing) => {
      const f = fixture();
      delete f.tracked[missing];

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({ status: "pending" });
      expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    },
  );

  it.each(["nonce", "signerAddress"] as const)(
    "keeps a known hash pending without %s metadata",
    async (missing) => {
      const f = fixture();
      f.tracked.hash = HASH;
      delete f.tracked[missing];
      f.provider.getTransactionCount.mockResolvedValue(8);

      expect(await readShieldedSubmissionOutcome(f.tracked)).toEqual({
        status: "pending",
        hash: HASH,
      });
      expect(f.provider.getTransactionCount).not.toHaveBeenCalled();
    },
  );

  it.each(["network", "block", "events", "nonce", "receipt"] as const)(
    "propagates %s RPC failures so the caller can retry",
    async (stage) => {
      const f = fixture();
      const failure = new Error("RPC unavailable");
      if (stage === "network") f.provider.getNetwork.mockRejectedValue(failure);
      else if (stage === "block") f.provider.getBlockNumber.mockRejectedValue(failure);
      else if (stage === "events") f.queryFilter.mockRejectedValue(failure);
      else if (stage === "nonce") f.provider.getTransactionCount.mockRejectedValue(failure);
      else {
        f.tracked.hash = HASH;
        f.provider.getTransactionReceipt.mockRejectedValue(failure);
      }

      await expect(readShieldedSubmissionOutcome(f.tracked)).rejects.toBe(failure);
    },
  );

  it("leaves a frozen tracking record and its outputs unchanged after discovering a hash", async () => {
    const f = fixture();
    f.queryFilter.mockResolvedValue([
      { args: { commitment: 101n }, transactionHash: HASH },
      { args: { commitment: 100n }, transactionHash: HASH },
    ]);
    const outputs = Object.freeze(["100", "101"]);
    const tracked = Object.freeze({
      ...f.tracked,
      outputCommitments: outputs as unknown as string[],
    });

    expect(await readShieldedSubmissionOutcome(tracked)).toEqual({ status: "pending", hash: HASH });
    expect(tracked.hash).toBeUndefined();
    expect(tracked.outputCommitments).toBe(outputs);
    expect(outputs).toEqual(["100", "101"]);
  });
});
