import assert from "node:assert/strict";
import { test } from "node:test";
import { ContractTransactionResponse, Interface, TransactionResponse } from "ethers";
import {
  executeChainTransaction,
  getChainErrorDetails,
  getTransactionErrorContext,
  runChainRead,
  waitForTransactionHashReceipt,
} from "../index.js";

const hash = `0x${"ab".repeat(32)}`;
const replacementHash = `0x${"cd".repeat(32)}`;
const from = `0x${"11".repeat(20)}`;
const to = `0x${"22".repeat(20)}`;
const scope = { chainId: 31337n, from, to, data: "0x1234", value: 0n, nonce: 3 };
const receipt = { hash, status: 1, blockNumber: 12 };
function transaction(wait = async () => receipt) {
  return { ...scope, hash, wait };
}

test("sends once after the awaited anchor and the final cancellation check", async () => {
  const calls = [];
  const response = transaction(async (confirmations, timeoutMs) => {
    calls.push(["wait", confirmations, timeoutMs]);
    return receipt;
  });
  response.replaceableTransaction = (block) => { calls.push(["anchor", block]); return response; };
  const result = await executeChainTransaction({
    provider: { getBlockNumber: async () => { calls.push("block"); return 10; } },
    assertActive: () => calls.push("active"),
    send: async () => { calls.push("send"); return response; },
    onTransactionSubmitted: async (tx) => { assert.equal(tx, response); calls.push("journal"); },
    onSubmitted: async (value) => { assert.equal(value, hash); calls.push("submitted"); },
    onConfirmed: async (value, confirmed) => { assert.equal(value, hash); assert.equal(confirmed, receipt); calls.push("confirmed"); },
    confirmations: 2, timeoutMs: 500,
  });
  assert.equal(result.transaction, response);
  assert.deepEqual(calls, ["block", "active", "send", "journal", ["anchor", 10], "submitted", ["wait", 2, 500], "confirmed"]);
});

test("a cancellation during anchor lookup cannot open the wallet", async () => {
  let active = true;
  let sends = 0;
  await assert.rejects(executeChainTransaction({
    provider: { getBlockNumber: async () => { active = false; return 10; } },
    assertActive: () => { if (!active) throw Object.assign(new Error("cancelled"), { code: "FLOW_CANCELLED" }); },
    send: async () => { sends++; return transaction(); },
  }), (error) => {
    assert.equal(getChainErrorDetails(error).category, "cancelled");
    return true;
  });
  assert.equal(sends, 0);
});

test("does not interrupt public receipt tracking after the transaction was sent", async () => {
  let active = true;
  let assertions = 0;
  const result = await executeChainTransaction({
    fromBlock: 10,
    assertActive: () => { assertions++; assert.equal(active, true); },
    send: async () => { active = false; return transaction(); },
  });
  assert.equal(result.receipt, receipt);
  assert.equal(assertions, 1);
});

test("retains a known broadcast hash on an uncertain wallet send without sending again", async () => {
  const cause = Object.assign(new Error("wallet transport failed"), {
    code: "NETWORK_ERROR", info: { sendTransactionHash: hash, privateDiagnostic: "secret" },
  });
  let sends = 0;
  const published = [];
  await assert.rejects(executeChainTransaction({
    send: async () => { sends++; throw cause; }, onSubmitted: (value) => published.push(value),
  }), (error) => {
    assert.equal(error, cause);
    assert.deepEqual(getChainErrorDetails(error), {
      category: "network", operation: "submit", code: "NETWORK_ERROR", retryable: false, transactionHash: hash,
    });
    return true;
  });
  assert.equal(sends, 1);
  assert.deepEqual(published, [hash]);
});

for (const callback of ["onTransactionSubmitted", "onSubmitted"]) {
  test(`retains the sent hash when ${callback} fails without continuing to wait`, async () => {
    let waits = 0;
    const cause = new Error("record write failed");
    await assert.rejects(executeChainTransaction({
      send: async () => transaction(async () => { waits++; return receipt; }),
      [callback]: () => { throw cause; },
    }), (error) => {
      assert.equal(error, cause);
      assert.deepEqual(getTransactionErrorContext(error), { transactionHash: hash });
      assert.equal(getChainErrorDetails(error).retryable, false);
      return true;
    });
    assert.equal(waits, 0);
  });
}

test("a failed completion callback retains successful confirmation", async () => {
  await assert.rejects(executeChainTransaction({
    send: async () => transaction(),
    onConfirmed: () => { throw Object.freeze(new Error("local refresh unavailable")); },
  }), (error) => {
    assert.deepEqual(getTransactionErrorContext(error), { transactionHash: hash, transactionConfirmed: true });
    assert.equal(getChainErrorDetails(error).category, "verification");
    assert.equal(getChainErrorDetails(error).retryable, false);
    return true;
  });
});

test("discovers an exact fee replacement from a real ethers contract response", async () => {
  const iface = new Interface(["function update(uint256)"]);
  const confirmed = { ...receipt, hash: replacementHash };
  let replacement;
  const provider = {
    getBlockNumber: async () => 12,
    getTransactionCount: async () => 4,
    getTransaction: async () => null,
    getTransactionReceipt: async (requested) => requested === hash ? null : confirmed,
    getBlock: async () => ({
      length: 1,
      *[Symbol.iterator]() { yield replacementHash; },
      getTransaction: async () => replacement,
    }),
  };
  const params = { ...scope, hash, gasLimit: 100_000n, gasPrice: 1n, type: 0, index: 0 };
  const original = new ContractTransactionResponse(iface, provider, params);
  replacement = new TransactionResponse({ ...params, hash: replacementHash, gasPrice: 2n, blockNumber: 12 }, provider);
  let sends = 0;
  const published = [];
  const result = await executeChainTransaction({
    provider, send: async () => { sends++; return original; }, onSubmitted: (value) => published.push(value),
  });
  assert.equal(result.transactionHash, replacementHash);
  assert.equal(sends, 1);
  assert.deepEqual(published, [hash, replacementHash]);
});

test("contract creation can explicitly reject any replacement without reporting it as success", async () => {
  const original = transaction(async () => {
    throw Object.assign(new Error("repriced"), {
      code: "TRANSACTION_REPLACED", reason: "repriced", cancelled: false,
      replacement: { ...scope, to: null, hash: replacementHash }, receipt: { ...receipt, hash: replacementHash },
    });
  });
  original.to = null;
  await assert.rejects(executeChainTransaction({ send: async () => original, replacementPolicy: "reject" }), {
    code: "TRANSACTION_REPLACEMENT_CANCELLED", transactionHash: hash,
  });
});

test("read failures preserve the raw error and canonical classification without retry", async () => {
  const cause = Object.assign(new Error("offline"), { code: "NETWORK_ERROR", data: "private request" });
  let reads = 0;
  await assert.rejects(runChainRead({ read: async () => { reads++; throw cause; }, operation: "estimate" }), (error) => {
    assert.equal(error, cause);
    assert.deepEqual(getChainErrorDetails(error), { category: "network", operation: "estimate", code: "NETWORK_ERROR", retryable: true });
    return true;
  });
  assert.equal(reads, 1);
});

test("journal recovery waits for only the stored hash with the configured policies", async () => {
  const calls = [];
  assert.deepEqual(await waitForTransactionHashReceipt({
    transactionHash: hash, confirmations: 3, timeoutMs: 100,
    provider: { waitForTransaction: async (...args) => { calls.push(args); return receipt; } },
  }), { transactionHash: hash, receipt });
  assert.deepEqual(calls, [[hash, 3, 100]]);
});

test("a wallet's failed automatic gas estimate remains an estimate failure before broadcast", async () => {
  const cause = Object.assign(new Error("automatic estimate reverted"), { code: "CALL_EXCEPTION", action: "estimateGas" });
  const published = [];
  await assert.rejects(executeChainTransaction({
    send: async () => { throw cause; }, onSubmitted: (value) => published.push(value),
  }), (error) => {
    assert.equal(error, cause);
    assert.deepEqual(getChainErrorDetails(error), { category: "validation", operation: "estimate", code: "CALL_EXCEPTION", retryable: false });
    return true;
  });
  assert.deepEqual(published, []);
});

test("submission-recording errors after a wallet response cannot be mistaken for an unsent estimate", async () => {
  const cause = Object.assign(new Error("journal failed"), { code: "CALL_EXCEPTION", action: "estimateGas" });
  await assert.rejects(executeChainTransaction({
    send: async () => transaction(), onTransactionSubmitted: () => { throw cause; },
  }), (error) => {
    assert.equal(error, cause);
    assert.equal(getChainErrorDetails(error).operation, "submit");
    assert.equal(getChainErrorDetails(error).transactionHash, hash);
    assert.equal(getChainErrorDetails(error).retryable, false);
    return true;
  });
});

test("an anchor RPC failure is a read failure and cannot request a wallet transaction", async () => {
  let sends = 0;
  await assert.rejects(executeChainTransaction({
    provider: { getBlockNumber: async () => { throw Object.assign(new Error("RPC offline"), { code: "NETWORK_ERROR" }); } },
    send: async () => { sends++; return transaction(); },
  }), (error) => {
    assert.deepEqual(getChainErrorDetails(error), { category: "network", operation: "read", code: "NETWORK_ERROR", retryable: true });
    return true;
  });
  assert.equal(sends, 0);
});
