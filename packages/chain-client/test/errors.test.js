import assert from "node:assert/strict";
import { test } from "node:test";
import { ChainOperationError, getChainErrorDetails, getTransactionErrorContext, normalizeChainError, withConfirmedTransaction, withTransactionHash } from "../index.js";

test("foreign rejections preserve whether an original diagnostic is available", () => {
  const unspecified = normalizeChainError(null);
  assert.ok(unspecified instanceof ChainOperationError);
  assert.equal(unspecified.messageAvailable, false);
  assert.equal(normalizeChainError("RPC offline").messageAvailable, true);
  assert.equal(normalizeChainError({ message: "RPC offline" }).message, "RPC offline");
});

for (const rejection of [
  { code: "UNKNOWN_ERROR", info: { error: { code: 4001 } } },
  { error: { code: 4001 } },
  { cause: { code: 4001, privateKey: "secret" } },
]) test("classifies nested wallet rejection without copying its private envelope", () => {
  for (const error of [rejection, Object.assign(new Error("rejected"), rejection)]) {
    const normalized = normalizeChainError(error, { operation: "submit" });
    assert.equal(getChainErrorDetails(normalized).category, "cancelled");
    assert.equal(getChainErrorDetails(withTransactionHash(normalized, "0xsubmitted")).retryable, false);
    if (!(error instanceof Error)) assert.equal(normalized.cause, undefined);
  }
});

test("wallet classification only reads bounded known envelopes without invoking getters", () => {
  let reads = 0;
  const cyclic = { request: { code: 4001 } };
  cyclic.cause = cyclic;
  Object.defineProperty(cyclic, "error", { get() { reads++; throw new Error("private"); } });
  assert.equal(getChainErrorDetails(cyclic).category, "unknown");
  assert.equal(reads, 0);
});

for (const [code, operation, category] of [
  ["ACTION_REJECTED", "submit", "cancelled"], [4001, "submit", "cancelled"],
  ["INSUFFICIENT_FUNDS", "submit", "wallet"], ["NETWORK_ERROR", "read", "network"],
  ["TIMEOUT", "confirm", "network"], ["CALL_EXCEPTION", "confirm", "reverted"],
  ["INVALID_ARGUMENT", "read", "validation"], ["TRANSACTION_RECEIPT_MISMATCH", "confirm", "verification"],
]) test(`classifies ${code} at the ${operation} boundary`, () => {
  const original = Object.assign(new Error("failure"), { code });
  assert.equal(normalizeChainError(original, { operation }), original);
  assert.deepEqual(getChainErrorDetails(original), {
    category, operation, code, retryable: category === "network" && operation === "read",
  });
});

test("explicit domain classification and later confirmation override old metadata", () => {
  const original = normalizeChainError(Object.assign(new Error("mismatch"), { code: "NETWORK_ERROR" }), { operation: "read" });
  const hash = `0x${"11".repeat(32)}`;
  const confirmed = withConfirmedTransaction(original, hash, "mismatch");
  assert.equal(confirmed, original);
  assert.deepEqual(getChainErrorDetails(confirmed), {
    category: "verification", operation: "verify", code: "NETWORK_ERROR", retryable: false,
    transactionHash: hash, transactionConfirmed: true, verificationFailure: "mismatch",
  });
  assert.equal(getChainErrorDetails(original, { category: "cancelled" }).category, "cancelled");
});

test("public metadata excludes diagnostics and preserves original domain error identity", () => {
  class ExpiredCredentialError extends Error {}
  const receipt = { status: 0 };
  const original = Object.assign(new ExpiredCredentialError("credential expired"), {
    code: "CALL_EXCEPTION", data: "0x1234", receipt, info: { secret: "private diagnostic" },
    witness: "secret", cause: { privateKey: "private" },
  });
  const normalized = normalizeChainError(original, { operation: "confirm" });
  assert.equal(normalized, original);
  assert.ok(normalized instanceof ExpiredCredentialError);
  assert.equal(normalized.data, "0x1234");
  assert.equal(normalized.receipt, receipt);
  assert.deepEqual(getChainErrorDetails(normalized), {
    category: "reverted", operation: "confirm", code: "CALL_EXCEPTION", retryable: false,
  });
  assert.ok(Object.isFrozen(normalized.chainError));
  assert.equal(Object.keys(normalized).includes("chainError"), false);
});

test("frozen domain errors retain their identity and canonical public metadata", () => {
  class DomainError extends Error {}
  const original = Object.freeze(Object.assign(new DomainError("timeout"), { code: "TIMEOUT" }));
  assert.equal(normalizeChainError(original, { operation: "read" }), original);
  assert.equal(getChainErrorDetails(original).retryable, true);
});

test("hash context updated after normalization replaces the previous hash", () => {
  const original = normalizeChainError(new Error("unknown"), { transactionHash: "0xold" });
  const updated = withTransactionHash(original, "0xnew");
  assert.deepEqual(getTransactionErrorContext(updated), { transactionHash: "0xnew" });
});

test("public inspection does not invoke accessors or serialize arbitrary code values", () => {
  let reads = 0;
  const input = Object.defineProperty({}, "code", { get() { reads++; throw new Error("secret"); } });
  assert.equal(getChainErrorDetails(input).code, "CHAIN_OPERATION_FAILED");
  assert.equal(reads, 0);
  assert.equal(getChainErrorDetails({ code: "private secret diagnostic with spaces" }).code, "CHAIN_OPERATION_FAILED");
});

test("a submitted hash and confirmation failure are never marked safe for retry", () => {
  const error = Object.assign(new Error("RPC offline"), { code: "NETWORK_ERROR" });
  assert.equal(getChainErrorDetails(error, { operation: "read", transactionHash: "0xhash" }).retryable, false);
  assert.equal(getChainErrorDetails(error, { operation: "submit" }).retryable, false);
  assert.equal(getChainErrorDetails(error, { operation: "confirm" }).retryable, false);
});

test("infers raw ethers estimate and send operations while explicit boundaries remain authoritative", () => {
  const estimate = Object.assign(new Error("reverted estimate"), { code: "CALL_EXCEPTION", action: "estimateGas" });
  assert.equal(getChainErrorDetails(estimate).operation, "estimate");
  assert.equal(getChainErrorDetails(estimate).category, "validation");
  const send = Object.assign(new Error("send failed"), { code: "NETWORK_ERROR", action: "sendTransaction" });
  assert.equal(getChainErrorDetails(send).operation, "submit");
  assert.equal(getChainErrorDetails(send).retryable, false);
  normalizeChainError(send, { operation: "confirm" });
  assert.equal(getChainErrorDetails(send).operation, "confirm");
});

test("reclassifies inferred errors at the final boundary while retaining explicit domain categories", () => {
  const simulated = normalizeChainError(Object.assign(new Error("simulation reverted"), { code: "CALL_EXCEPTION", action: "call" }), { operation: "read" });
  assert.equal(getChainErrorDetails(simulated).category, "reverted");
  normalizeChainError(simulated, { operation: "estimate" });
  assert.equal(getChainErrorDetails(simulated).category, "validation");
  const domain = normalizeChainError(new Error("invalid frozen content"), { category: "validation", operation: "read" });
  normalizeChainError(domain, { operation: "submit" });
  assert.equal(getChainErrorDetails(domain).category, "validation");
});

test("a pending wallet request permits a manual retry only before any broadcast hash exists", () => {
  for (const shape of [
    { code: -32002 },
    { code: "UNKNOWN_ERROR", info: { error: { code: -32002 } } },
    { code: "WALLET_REQUEST_PENDING" },
  ]) {
    const error = Object.assign(new Error("wallet request already pending"), shape);
    assert.deepEqual(getChainErrorDetails(error, { operation: "submit" }), {
      category: "wallet", operation: "submit", code: "WALLET_REQUEST_PENDING", retryable: true,
    });
    assert.equal(getChainErrorDetails(error, { operation: "submit", transactionHash: "0xknown" }).retryable, false);
  }
});

for (const code of [4100, 4200, 4900, 4901, 4902]) test(`classifies wallet code ${code} across known envelopes`, () => {
  for (const raw of [{ code }, { code: "UNKNOWN_ERROR", info: { error: { code } } }]) {
    const details = getChainErrorDetails(normalizeChainError(raw, { operation: "submit" }));
    assert.equal(details.category, "wallet");
    assert.equal(details.code, code);
    assert.equal(details.retryable, false);
  }
});

test("standard nested RPC balance failures keep the same classification as ethers errors", () => {
  const raw = { code: "UNKNOWN_ERROR", info: { error: { code: -32000,
    message: "insufficient funds for gas * price + value", request: { privateKey: "secret" } } } };
  const normalized = normalizeChainError(raw, { operation: "submit" });
  assert.deepEqual(getChainErrorDetails(normalized), {
    category: "wallet", operation: "submit", code: "INSUFFICIENT_FUNDS", retryable: false,
  });
});

test("adding a hash to a frozen classified error retains its canonical boundary and domain category", () => {
  const original = Object.freeze(normalizeChainError(new Error("domain content failed validation"), {
    category: "validation", operation: "estimate",
  }));
  const tracked = withTransactionHash(original, "0xknown");
  assert.deepEqual(getChainErrorDetails(tracked), {
    category: "validation", operation: "estimate", code: "CHAIN_OPERATION_FAILED", retryable: false, transactionHash: "0xknown",
  });
});
