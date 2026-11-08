import assert from "node:assert/strict";
import { test } from "node:test";
import { TransactionResponse } from "ethers";
import { waitForExactTransactionReceipt } from "../index.js";

const originalHash = `0x${"11".repeat(32)}`;
const replacementHash = `0x${"22".repeat(32)}`;
const from = `0x${"33".repeat(20)}`;
const to = `0x${"44".repeat(20)}`;
const scope = { chainId: 31337n, from, to, data: "0xabcd", value: 0n, nonce: 3 };
const receipt = (hash = originalHash, status = 1) => ({ hash, status, blockNumber: 10 });
function replacementFixture() {
  const confirmed = receipt(replacementHash);
  const replacement = { ...scope, hash: replacementHash, wait: async () => confirmed };
  const error = Object.assign(new Error("repriced"), {
    code: "TRANSACTION_REPLACED",
    cancelled: false,
    reason: "repriced",
    replacement,
    receipt: confirmed,
  });
  const transaction = {
    ...scope,
    hash: originalHash,
    wait: async () => {
      throw error;
    },
  };
  return { transaction, replacement, error, confirmed };
}

test("passes confirmation and timeout policies to the transaction wait", async () => {
  let received;
  const confirmed = receipt();
  const transaction = {
    ...scope,
    hash: originalHash,
    wait: async (...args) => {
      received = args;
      return confirmed;
    },
  };
  assert.deepEqual(
    await waitForExactTransactionReceipt({ transaction, confirmations: 3, timeoutMs: 45000 }),
    { receipt: confirmed, transactionHash: originalHash },
  );
  assert.deepEqual(received, [3, 45000]);
});

test("accepts only a fee replacement of the same frozen call and reports its final hash", async () => {
  const f = replacementFixture();
  const submitted = [];
  assert.deepEqual(
    await waitForExactTransactionReceipt({
      transaction: f.transaction,
      onSubmitted: (hash) => submitted.push(hash),
    }),
    { receipt: f.confirmed, transactionHash: replacementHash },
  );
  assert.deepEqual(submitted, [originalHash, replacementHash]);
});

for (const [field, value] of [
  ["chainId", 1n],
  ["from", to],
  ["to", from],
  ["data", "0xdcba"],
  ["value", 1n],
  ["nonce", 4],
]) {
  test(`rejects a replacement with changed ${field}`, async () => {
    const f = replacementFixture();
    f.replacement[field] = value;
    await assert.rejects(waitForExactTransactionReceipt({ transaction: f.transaction }), {
      code: "TRANSACTION_REPLACEMENT_MISMATCH",
      transactionHash: originalHash,
    });
  });
}

test("rejects replacement when original nonce or full identity is unavailable", async () => {
  const f = replacementFixture();
  delete f.transaction.nonce;
  await assert.rejects(waitForExactTransactionReceipt({ transaction: f.transaction }), {
    code: "TRANSACTION_REPLACEMENT_MISMATCH",
  });
  await assert.rejects(
    waitForExactTransactionReceipt({
      transaction: { hash: originalHash, wait: f.transaction.wait },
    }),
    { code: "TRANSACTION_REPLACEMENT_MISMATCH" },
  );
});

test("never accepts cancellation even under reverted-receipt reconciliation policy", async () => {
  const f = replacementFixture();
  f.error.cancelled = true;
  await assert.rejects(
    waitForExactTransactionReceipt({ transaction: f.transaction, requireSuccess: false }),
    { code: "TRANSACTION_REPLACEMENT_CANCELLED", transactionHash: originalHash },
  );
});

test("follows a replacement without an attached receipt and preserves its hash on RPC failure", async () => {
  const f = replacementFixture();
  delete f.error.receipt;
  f.replacement.wait = async () => {
    throw new Error("RPC unavailable");
  };
  await assert.rejects(waitForExactTransactionReceipt({ transaction: f.transaction }), {
    message: "RPC unavailable",
    transactionHash: replacementHash,
  });
});

for (const [label, result] of [
  ["different hash", receipt(replacementHash)],
  ["failed status", receipt(originalHash, 0)],
  ["null receipt", null],
]) {
  test(`strictly rejects ${label}`, async () => {
    const transaction = { ...scope, hash: originalHash, wait: async () => result };
    await assert.rejects(waitForExactTransactionReceipt({ transaction }), {
      code: "TRANSACTION_RECEIPT_MISMATCH",
      transactionHash: originalHash,
    });
  });
}

test("explicit reconciliation accepts matching reverted receipt returned or thrown by ethers", async () => {
  const failed = receipt(originalHash, 0);
  for (const throws of [false, true]) {
    const transaction = {
      ...scope,
      hash: originalHash,
      wait: async () => {
        if (throws)
          throw Object.assign(new Error("execution reverted"), {
            code: "CALL_EXCEPTION",
            receipt: failed,
          });
        return failed;
      },
    };
    assert.deepEqual(await waitForExactTransactionReceipt({ transaction, requireSuccess: false }), {
      receipt: failed,
      transactionHash: originalHash,
    });
  }
});

for (const status of [null, undefined, "", 2, false, []]) {
  test(`reconciliation rejects unknown receipt status ${String(status)}`, async () => {
    const transaction = {
      hash: originalHash,
      wait: async () => ({ ...receipt(originalHash), status }),
    };
    await assert.rejects(waitForExactTransactionReceipt({ transaction, requireSuccess: false }), {
      code: "TRANSACTION_RECEIPT_MISMATCH",
    });
  });
}

test("reconciliation rejects a reverted receipt for a different transaction", async () => {
  const transaction = {
    hash: originalHash,
    wait: async () => {
      throw Object.assign(new Error("reverted"), {
        code: "CALL_EXCEPTION",
        receipt: receipt(replacementHash, 0),
      });
    },
  };
  await assert.rejects(waitForExactTransactionReceipt({ transaction, requireSuccess: false }), {
    code: "TRANSACTION_RECEIPT_MISMATCH",
    transactionHash: originalHash,
  });
});

test("tracks fee replacement errors emitted by the real ethers wait implementation", async () => {
  const confirmed = receipt(replacementHash);
  let replacement;
  const provider = {
    getTransactionReceipt: async (hash) => (hash === originalHash ? null : confirmed),
    getBlockNumber: async () => 10,
    getTransactionCount: async () => 1,
    getTransaction: async () => null,
    getBlock: async () => ({
      length: 1,
      [Symbol.iterator]: function* () {
        yield replacementHash;
      },
      getTransaction: async () => replacement,
    }),
  };
  const params = {
    ...scope,
    hash: originalHash,
    nonce: 0,
    gasLimit: 100_000n,
    gasPrice: 1n,
    type: 0,
    index: 0,
  };
  const transaction = new TransactionResponse(params, provider).replaceableTransaction(10);
  replacement = new TransactionResponse(
    { ...params, hash: replacementHash, gasPrice: 2n, blockNumber: 10 },
    provider,
  );
  assert.deepEqual(await waitForExactTransactionReceipt({ transaction }), {
    receipt: confirmed,
    transactionHash: replacementHash,
  });
});

test("rejects a cyclic replacement even if it comes with a successful receipt", async () => {
  const f = replacementFixture();
  f.replacement.hash = originalHash;
  f.confirmed.hash = originalHash;
  await assert.rejects(waitForExactTransactionReceipt({ transaction: f.transaction }), {
    code: "TRANSACTION_REPLACEMENT_MISMATCH",
  });
});
