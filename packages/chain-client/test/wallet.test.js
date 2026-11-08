import assert from "node:assert/strict";
import { test } from "node:test";
import { assertChainWalletScope, executeChainTransaction, getChainErrorDetails } from "../index.js";

const account = `0x${"11".repeat(20)}`;
const other = `0x${"22".repeat(20)}`;
function fixture() {
  const calls = [];
  const signer = {
    provider: { send: async (...args) => { calls.push(args); return "0x7a69"; }, getNetwork: async () => ({ chainId: 1n }) },
    getAddress: async () => account,
  };
  return { signer, calls, input: { signer, chainId: 31337, account } };
}
test("wallet scope uses the raw injected chain rather than a cached provider network", async () => {
  const f = fixture();
  await assertChainWalletScope(f.input);
  assert.deepEqual(f.calls, [["eth_chainId", []]]);
});
test("wallet scope rejects the wrong chain or account before any send", async () => {
  for (const changed of [{ chainId: 1 }, { account: other }]) {
    const f = fixture();
    let sends = 0;
    await assert.rejects(executeChainTransaction({
      beforeSend: () => assertChainWalletScope({ ...f.input, ...changed }),
      send: async () => { sends++; throw new Error("must not send"); },
    }), (error) => {
      assert.equal(error.code, "CHAIN_WALLET_SCOPE_CHANGED");
      assert.equal(getChainErrorDetails(error).category, "wallet");
      assert.equal(getChainErrorDetails(error).operation, "submit");
      return true;
    });
    assert.equal(sends, 0);
  }
});
test("a pre-send wallet RPC failure retains its read phase without submitting", async () => {
  const f = fixture();
  const unavailable = Object.assign(new Error("wallet RPC unavailable"), { code: "NETWORK_ERROR" });
  f.signer.provider.send = async () => { throw unavailable; };
  let sends = 0;
  await assert.rejects(executeChainTransaction({
    beforeSend: () => assertChainWalletScope(f.input),
    send: async () => { sends++; throw new Error("must not send"); },
  }), (error) => {
    assert.equal(error, unavailable);
    assert.deepEqual(getChainErrorDetails(error), {
      category: "network", operation: "read", code: "NETWORK_ERROR", retryable: true,
    });
    return true;
  });
  assert.equal(sends, 0);
});
test("wallet scope rechecks cancellation after asynchronous wallet reads", async () => {
  const f = fixture();
  let active = true;
  f.signer.getAddress = async () => { active = false; return account; };
  await assert.rejects(assertChainWalletScope({ ...f.input, assertActive: () => { if (!active) throw new Error("cancelled"); } }), /cancelled/);
});
test("wallet scope supports Node signers without raw RPC send", async () => {
  await assertChainWalletScope({ signer: { getAddress: async () => account,
    provider: { getNetwork: async () => ({ chainId: 31337n }) } }, chainId: 31337, account });
});
test("the final active check runs after an asynchronous beforeSend check", async () => {
  let active = true;
  let sends = 0;
  await assert.rejects(executeChainTransaction({
    beforeSend: async () => { active = false; },
    assertActive: () => { if (!active) throw new Error("cancelled"); },
    send: async () => { sends++; throw new Error("must not send"); },
  }), /cancelled/);
  assert.equal(sends, 0);
});
