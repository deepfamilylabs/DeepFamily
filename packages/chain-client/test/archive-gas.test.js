import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHIVE_CHAIN_PROFILES, validateArchiveGas } from "../index.js";
const input = {
  estimatedGas: 1001n,
  chainId: 31337n,
  blockGasLimit: 30_000_000n,
  calldata: "0x1234",
};

test("uses an integer ceiling for the 20 percent gas buffer", () => {
  assert.deepEqual(validateArchiveGas(input), {
    estimatedGas: 1001n,
    gasLimit: 1202n,
    nativeSymbol: "ETH",
  });
});

test("enforces supported profiles, block capacity and Ethereum transaction capacity", () => {
  assert.throws(() => validateArchiveGas({ ...input, chainId: 999n }), {
    code: "ARCHIVE_NETWORK_NOT_CONFIGURED",
  });
  assert.throws(() => validateArchiveGas({ ...input, blockGasLimit: null }), {
    code: "ARCHIVE_BLOCK_GAS_UNAVAILABLE",
  });
  assert.throws(() => validateArchiveGas({ ...input, blockGasLimit: 1201n }), {
    code: "ARCHIVE_GAS_LIMIT_EXCEEDED",
  });
  assert.throws(() => validateArchiveGas({ ...input, estimatedGas: 15_000_000n, chainId: 1n }), {
    code: "ARCHIVE_GAS_LIMIT_EXCEEDED",
  });
});

test("applies the eSpace calldata floor and native currency without another block gas fraction", () => {
  assert.equal(validateArchiveGas({ ...input, chainId: 1030n }).nativeSymbol, "CFX");
  assert.throws(
    () => validateArchiveGas({ ...input, chainId: 71n, calldata: `0x${"ab".repeat(13)}` }),
    { code: "ARCHIVE_GAS_BELOW_CALLDATA_FLOOR" },
  );
  assert.equal(
    validateArchiveGas({ ...input, chainId: 1030n, estimatedGas: 25_000_000n }).gasLimit,
    30_000_000n,
  );
});

for (const estimatedGas of [0n, -1n, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid gas estimate ${String(estimatedGas)}`, () => {
    assert.throws(() => validateArchiveGas({ ...input, estimatedGas }), {
      code: "ARCHIVE_GAS_ESTIMATE_INVALID",
    });
  });
}

test("chain profiles cannot be mutated by an application", () => {
  assert.ok(Object.isFrozen(ARCHIVE_CHAIN_PROFILES));
  assert.ok(Object.isFrozen(ARCHIVE_CHAIN_PROFILES["1"]));
});
