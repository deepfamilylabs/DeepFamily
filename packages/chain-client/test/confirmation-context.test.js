import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getTransactionErrorContext,
  withTransactionHash,
  withConfirmedTransaction,
  readConfirmedDetails,
  verifyConfirmedDetails,
} from "../index.js";
const hash = `0x${"ab".repeat(32)}`;

test("public context contains only recognized tracking fields and never invokes getters", () => {
  let reads = 0;
  const error = Object.assign(new Error("private diagnostic"), {
    transactionHash: hash,
    transactionConfirmed: true,
    verificationFailure: "read",
    passphrase: "secret",
    proof: { secret: "witness" },
    cause: { privateKey: "sensitive" },
  });
  assert.deepEqual(getTransactionErrorContext(error), {
    transactionHash: hash,
    transactionConfirmed: true,
    verificationFailure: "read",
  });
  const accessor = Object.defineProperty({}, "transactionHash", {
    get() {
      reads += 1;
      throw new Error("secret");
    },
  });
  assert.deepEqual(getTransactionErrorContext(accessor), {});
  assert.equal(reads, 0);
  assert.deepEqual(getTransactionErrorContext(null), {});
  assert.deepEqual(
    getTransactionErrorContext({
      transactionHash: 12,
      transactionConfirmed: "yes",
      verificationFailure: "private",
    }),
    {},
  );
});

test("adding tracking context does not serialize unknown errors or retain new secret causes", () => {
  const error = withTransactionHash(
    {
      passphrase: "secret",
      toString() {
        throw new Error("must not stringify");
      },
    },
    hash,
  );
  assert.equal(error.message, "Transaction tracking failed");
  assert.equal(error.cause, undefined);
  assert.deepEqual(getTransactionErrorContext(error), { transactionHash: hash });
});

test("preserves the hash even when a foreign error is frozen", () => {
  const error = withTransactionHash(
    Object.freeze(Object.assign(new Error("RPC unavailable"), { code: "NETWORK_ERROR" })),
    hash,
  );
  assert.equal(error.code, "NETWORK_ERROR");
  assert.deepEqual(getTransactionErrorContext(error), { transactionHash: hash });
});

test("distinguishes failed reading from invalid returned data after confirmation", async () => {
  await assert.rejects(
    verifyConfirmedDetails(hash, () =>
      readConfirmedDetails(hash, async () => {
        throw new Error("RPC offline");
      }),
    ),
    (error) => {
      assert.deepEqual(getTransactionErrorContext(error), {
        transactionHash: hash,
        transactionConfirmed: true,
        verificationFailure: "read",
      });
      return true;
    },
  );
  await assert.rejects(
    verifyConfirmedDetails(hash, async () => {
      throw new Error("commitment mismatch");
    }),
    (error) => {
      assert.deepEqual(getTransactionErrorContext(error), {
        transactionHash: hash,
        transactionConfirmed: true,
        verificationFailure: "mismatch",
      });
      return true;
    },
  );
  assert.deepEqual(
    getTransactionErrorContext(withConfirmedTransaction(new Error("invalid"), hash, "mismatch")),
    { transactionHash: hash, transactionConfirmed: true, verificationFailure: "mismatch" },
  );
});

test("annotates confirmation of a frozen error that already has a hash", () => {
  const original = Object.freeze(
    Object.assign(new Error("readback unavailable"), { transactionHash: hash }),
  );
  const confirmed = withConfirmedTransaction(original, hash, "read");
  assert.deepEqual(getTransactionErrorContext(confirmed), {
    transactionHash: hash,
    transactionConfirmed: true,
    verificationFailure: "read",
  });
  assert.equal(confirmed.cause, undefined);
});
