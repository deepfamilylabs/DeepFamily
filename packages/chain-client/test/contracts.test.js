import assert from "node:assert/strict";
import { test } from "node:test";
import { AbiCoder, Contract } from "ethers";
import { createChainContract, getChainErrorDetails, instrumentChainContract } from "../index.js";
const address = `0x${"11".repeat(20)}`;
const nextAddress = `0x${"22".repeat(20)}`;
const abi = ["function value() view returns (uint256)", "function update(uint256)", "event Changed(uint256)"];

test("preserves real ethers Contract read APIs and non-configurable properties", async () => {
  const runner = { call: async () => AbiCoder.defaultAbiCoder().encode(["uint256"], [42n]) };
  const contract = createChainContract(address, abi, runner);
  assert.ok(contract instanceof Contract);
  assert.equal(contract.runner, runner);
  assert.equal(contract.interface.getFunction("value").name, "value");
  assert.equal(await contract.value(), 42n);
  assert.equal(await contract.getFunction("value").staticCall(), 42n);
  assert.equal(contract.value.fragment.stateMutability, "view");
  assert.equal(await contract.getAddress(), address);
  assert.equal(await contract.attach(nextAddress).getAddress(), nextAddress);
  assert.ok(contract.filters.Changed());
  assert.equal(instrumentChainContract(contract), contract);
});

test("normalizes real ethers reads, estimates and sends without losing the raw error", async () => {
  const errors = {
    read: Object.assign(new Error("offline"), { code: "NETWORK_ERROR", data: "0xread" }),
    estimate: Object.assign(new Error("estimate reverted"), { code: "CALL_EXCEPTION", action: "estimateGas", data: "0xestimate" }),
    submit: Object.assign(new Error("rejected"), { code: "ACTION_REJECTED" }),
  };
  const contract = createChainContract(address, abi, {
    call: async () => { throw errors.read; },
    estimateGas: async () => { throw errors.estimate; },
    sendTransaction: async () => { throw errors.submit; },
  });
  for (const [operation, call] of [
    ["read", () => contract.value()], ["read", () => contract.getFunction("update").staticCall(7)],
    ["estimate", () => contract.update.estimateGas(7)], ["submit", () => contract.update(7)],
    ["submit", () => contract.update.send(7)],
  ]) await assert.rejects(call, (error) => {
    assert.equal(error, errors[operation]);
    assert.equal(getChainErrorDetails(error).operation, operation);
    return true;
  });
});

test("connect keeps the instrumentation on the replacement runner", async () => {
  const error = Object.assign(new Error("new RPC offline"), { code: "NETWORK_ERROR" });
  const contract = createChainContract(address, abi, { call: async () => "0x" });
  const connected = contract.connect({ call: async () => { throw error; } });
  await assert.rejects(connected.value(), (cause) => {
    assert.equal(cause, error);
    assert.equal(getChainErrorDetails(cause).operation, "read");
    return true;
  });
});

test("a contract send that fails wallet gas estimation exposes the estimate boundary", async () => {
  const cause = Object.assign(new Error("automatic estimate reverted"), { code: "CALL_EXCEPTION", action: "estimateGas" });
  const contract = createChainContract(address, abi, { sendTransaction: async () => { throw cause; } });
  await assert.rejects(contract.update(3), (error) => {
    assert.equal(error, cause);
    assert.deepEqual(getChainErrorDetails(error), { category: "validation", operation: "estimate", code: "CALL_EXCEPTION", retryable: false });
    return true;
  });
});

test("retains event replay, subscription and listener APIs on the real ethers Contract", async () => {
  const subscriptions = [];
  const removals = [];
  const provider = {
    getLogs: async () => [log],
    on: async (filter, listener) => { subscriptions.push({ filter, listener }); },
    off: async (filter, listener) => { removals.push({ filter, listener }); },
  };
  const contract = createChainContract(address, abi, { provider });
  const encoded = contract.interface.encodeEventLog(contract.interface.getEvent("Changed"), [7n]);
  const log = {
    address, ...encoded, blockNumber: 12, blockHash: `0x${"ab".repeat(32)}`,
    transactionHash: `0x${"cd".repeat(32)}`, transactionIndex: 0, index: 0, removed: false,
  };
  const historical = await contract.queryFilter(contract.filters.Changed(), 10, 12);
  assert.equal(historical[0].args[0], 7n);
  let delivered;
  const observed = new Promise((resolve) => { delivered = resolve; });
  const listener = (value, payload) => { assert.equal(payload.log.transactionHash, log.transactionHash); delivered(value); };
  assert.equal(await contract.on("Changed", listener), contract);
  assert.equal(await contract.listenerCount("Changed"), 1);
  assert.deepEqual(await contract.listeners("Changed"), [listener]);
  subscriptions[0].listener(log);
  assert.equal(await observed, 7n);
  assert.equal(await contract.off("Changed", listener), contract);
  assert.equal(await contract.listenerCount("Changed"), 0);
  await Promise.resolve();
  assert.equal(removals.length, 1);
});

test("queryFilter failures preserve the RPC error with a read classification", async () => {
  const cause = Object.assign(new Error("log RPC unavailable"), { code: "NETWORK_ERROR" });
  const contract = createChainContract(address, abi, { provider: { getLogs: async () => { throw cause; } } });
  await assert.rejects(contract.queryFilter(contract.filters.Changed()), (error) => {
    assert.equal(error, cause);
    assert.deepEqual(getChainErrorDetails(error), { category: "network", operation: "read", code: "NETWORK_ERROR", retryable: true });
    return true;
  });
});
