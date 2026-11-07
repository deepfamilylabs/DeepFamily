import { describe, expect, it, vi } from "vitest";
import { TransactionResponse } from "ethers";
import { waitForExactTransactionReceipt } from "./exactTransactionReceipt";

const originalHash = `0x${"11".repeat(32)}`;
const replacementHash = `0x${"22".repeat(32)}`;
const from = `0x${"33".repeat(20)}`;
const to = `0x${"44".repeat(20)}`;
const scope = { chainId: 31337n, from, to, data: "0xabcd", value: 0n };

function setup() {
  const receipt = { hash: replacementHash, status: 1, blockNumber: 10 };
  const replacement = { ...scope, hash: replacementHash, wait: vi.fn(async () => receipt) };
  const replaced = { code: "TRANSACTION_REPLACED", cancelled: false, reason: "repriced", replacement, receipt };
  const transaction = { ...scope, hash: originalHash, wait: vi.fn(async () => { throw replaced; }) };
  return { transaction, replacement, receipt, replaced };
}

describe("exact transaction receipt tracking", () => {
  it("accepts a successful fee replacement and publishes its hash", async () => {
    const f = setup();
    const onSubmitted = vi.fn();
    await expect(waitForExactTransactionReceipt({ transaction: f.transaction, onSubmitted })).resolves.toEqual({
      receipt: f.receipt,
      transactionHash: replacementHash,
    });
    expect(onSubmitted.mock.calls).toEqual([[originalHash], [replacementHash]]);
  });

  it.each([
    ["chainId", 1n],
    ["from", to],
    ["to", from],
    ["data", "0xdcba"],
    ["value", 1n],
  ])("rejects a replacement whose %s differs from the original call", async (field, value) => {
    const f = setup();
    Object.assign(f.replacement, { [field]: value });
    await expect(waitForExactTransactionReceipt({ transaction: f.transaction })).rejects.toMatchObject({
      code: "TRANSACTION_REPLACEMENT_MISMATCH",
      transactionHash: originalHash,
    });
  });

  it("rejects a cancellation even when its receipt succeeded", async () => {
    const f = setup();
    f.replaced.cancelled = true;
    await expect(waitForExactTransactionReceipt({ transaction: f.transaction })).rejects.toMatchObject({
      code: "TRANSACTION_REPLACEMENT_CANCELLED",
      transactionHash: originalHash,
    });
  });

  it("requires complete frozen scope before accepting a replacement", async () => {
    const f = setup();
    await expect(waitForExactTransactionReceipt({ transaction: { hash: originalHash, wait: f.transaction.wait } })).rejects.toMatchObject({
      code: "TRANSACTION_REPLACEMENT_MISMATCH",
    });
  });

  it("waits for a matching replacement if its receipt is not supplied", async () => {
    const f = setup();
    delete (f.replaced as any).receipt;
    const onSubmitted = vi.fn();
    await expect(waitForExactTransactionReceipt({ transaction: f.transaction, onSubmitted })).resolves.toEqual({
      receipt: f.receipt,
      transactionHash: replacementHash,
    });
    expect(f.replacement.wait).toHaveBeenCalledOnce();
    expect(onSubmitted.mock.calls).toEqual([[originalHash], [replacementHash]]);
  });

  it.each([
    { hash: originalHash, status: 1 },
    { hash: replacementHash, status: 0 },
  ])("rejects a mismatched or unsuccessful replacement receipt", async (receipt) => {
    const f = setup();
    Object.assign(f.receipt, receipt);
    await expect(waitForExactTransactionReceipt({ transaction: f.transaction })).rejects.toMatchObject({
      code: "TRANSACTION_RECEIPT_MISMATCH",
      transactionHash: replacementHash,
    });
  });

  it("retains the latest known hash if receipt tracking fails", async () => {
    const f = setup();
    delete (f.replaced as any).receipt;
    f.replacement.wait.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(waitForExactTransactionReceipt({ transaction: f.transaction })).rejects.toMatchObject({
      message: "RPC unavailable",
      transactionHash: replacementHash,
    });
  });

  it("handles the replacement error emitted by the real ethers wait implementation", async () => {
    const receipt = { hash: replacementHash, status: 1, blockNumber: 10 };
    let replacement: TransactionResponse;
    const provider: any = {
      getTransactionReceipt: async (hash: string) => hash === originalHash ? null : receipt,
      getBlockNumber: async () => 10,
      getTransactionCount: async () => 1,
      getTransaction: async () => null,
      getBlock: async () => ({
        length: 1,
        [Symbol.iterator]: function* () { yield replacementHash; },
        getTransaction: async () => replacement,
      }),
    };
    const params = { ...scope, hash: originalHash, nonce: 0, gasLimit: 100_000n, gasPrice: 1n, type: 0, index: 0 };
    const transaction = new TransactionResponse(params as any, provider).replaceableTransaction(10);
    replacement = new TransactionResponse({ ...params, hash: replacementHash, gasPrice: 2n, blockNumber: 10 } as any, provider);
    await expect(waitForExactTransactionReceipt({ transaction })).resolves.toEqual({
      receipt,
      transactionHash: replacementHash,
    });
  });
});
