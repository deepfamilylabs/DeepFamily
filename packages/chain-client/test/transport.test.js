import assert from "node:assert/strict";
import { test } from "node:test";
import { getChainErrorDetails, normalizeChainError, serializeChainError, restoreChainError, withConfirmedTransaction } from "../index.js";

test("transport preserves safe classification without copying private diagnostics", () => {
  const original = normalizeChainError(Object.assign(new Error("private witness error"), {
    code: "NETWORK_ERROR", witness: "secret witness", request: { passphrase: "secret" },
    cause: { privateKey: "secret" },
  }), { operation: "read" });
  const dto = serializeChainError(original, "Unable to read public chain state");
  assert.equal(JSON.stringify(dto).includes("secret"), false);
  assert.equal(JSON.stringify(dto).includes("private witness"), false);
  const restored = restoreChainError(structuredClone(dto));
  assert.deepEqual(getChainErrorDetails(restored), getChainErrorDetails(original));
  assert.equal(restored.message, "Unable to read public chain state");
  assert.equal(restored.request, undefined);
  assert.equal(restored.cause, undefined);
});
test("transport preserves confirmed hashes and disables unsafe retry claims", () => {
  const hash = `0x${"ab".repeat(32)}`;
  const dto = serializeChainError(withConfirmedTransaction(new Error("read failed"), hash, "read"), "Refresh the confirmed result");
  dto.chainError.retryable = true;
  const restored = getChainErrorDetails(restoreChainError(dto));
  assert.equal(restored.transactionHash, hash);
  assert.equal(restored.transactionConfirmed, true);
  assert.equal(restored.verificationFailure, "read");
  assert.equal(restored.retryable, false);
});
test("transport never exports arbitrary code or invalid hash strings", () => {
  const dto = serializeChainError(Object.assign(new Error("failed"), {
    code: "secret_without_spaces", transactionHash: "private_passphrase", transactionConfirmed: true,
  }), "Operation failed");
  assert.equal(dto.chainError.code, "CHAIN_OPERATION_FAILED");
  assert.equal(dto.chainError.transactionHash, undefined);
  assert.equal(JSON.stringify(dto).includes("private_passphrase"), false);
});
test("malformed metadata and extra diagnostic fields are never restored", () => {
  const safe = serializeChainError(Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }), "Operation failed");
  for (const altered of [{ category: "secret" }, { operation: "secret" }, { code: "secret" },
    { retryable: "yes" }, { transactionHash: "secret" }, { transactionConfirmed: true },
    { verificationFailure: "mismatch" }]) {
    const restored = restoreChainError({ ...safe, chainError: { ...safe.chainError, ...altered }, witness: "secret" });
    assert.equal(getChainErrorDetails(restored).code, "CHAIN_OPERATION_FAILED");
    assert.equal(restored.witness, undefined);
  }
});
test("transport validation does not invoke getters", () => {
  let reads = 0;
  const input = Object.defineProperty({}, "chainError", { get() { reads++; throw new Error("secret"); } });
  assert.equal(getChainErrorDetails(restoreChainError(input)).category, "unknown");
  assert.equal(reads, 0);
});
