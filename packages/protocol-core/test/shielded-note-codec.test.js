import test from "node:test";
import assert from "node:assert/strict";
import {
  SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES,
  SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
  SHIELDED_POLICY_NOTE_PAYLOAD_BYTES,
  SHIELDED_VALUE_NOTE_PAYLOAD_BYTES,
  SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES,
  SNARK_SCALAR_FIELD,
  computeShieldedAllocationKeyCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedNoteCommitmentFromPayload,
  decodeShieldedNotePayload,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedPolicyNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  verifyShieldedNotePayload,
} from "../index.js";

const context = { chainId: 1030n, poolAddress: "0x0000000000000000000000000000000000000001" };
const keys = deriveShieldedHeirKeyMaterial(13n);
const value = { ownerCommitment: keys.ownerCommitment, amount: 300n, nonce: 29n };
const budget = {
  rootIdentityCommitment: 11n,
  rootVersionIndex: 2n,
  policySalt: 17n,
  allocationKeyCommitment: computeShieldedAllocationKeyCommitment(41n),
  heirIdentityCommitment: 19n,
  eligibleFrom: 2592001n,
  enrollmentSalt: 23n,
  heirOwnerCommitment: keys.ownerCommitment,
  amountPerPeriod: 100n,
  remaining: 1200n,
  nonce: 31n,
};
const policy = {
  rootIdentityCommitment: 11n,
  rootVersionIndex: 2n,
  amountPerPeriod: 100n,
  policySalt: 17n,
  allocationKey: 41n,
  nonce: 41n,
};
const memoValue = {
  ...value,
  topUpMemo: { budgetCommitment: 71n, budgetNote: budget },
};

test("strict binary value and budget payloads round-trip within HPKE envelope", () => {
  const valuePayload = encodeShieldedValueNotePayload(value);
  const budgetPayload = encodeShieldedBudgetNotePayload(budget);
  const policyPayload = encodeShieldedPolicyNotePayload(policy);
  const memoPayload = encodeShieldedValueNotePayload(memoValue);
  assert.equal(valuePayload.length, SHIELDED_VALUE_NOTE_PAYLOAD_BYTES);
  assert.equal(budgetPayload.length, SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES);
  assert.equal(policyPayload.length, SHIELDED_POLICY_NOTE_PAYLOAD_BYTES);
  assert.equal(memoPayload.length, SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES);
  assert.ok(memoPayload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.ok(budgetPayload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(valuePayload), { kind: "value", ...value });
  assert.deepEqual(decodeShieldedNotePayload(budgetPayload), { kind: "budget", ...budget });
  assert.deepEqual(decodeShieldedNotePayload(policyPayload), { kind: "policy", ...policy });
  assert.deepEqual(decodeShieldedNotePayload(memoPayload), { kind: "value", ...memoValue });
  assert.deepEqual(
    decodeShieldedNotePayload(encodeShieldedValueNotePayload({ ...value, amount: 0n })),
    {
      kind: "value",
      ...value,
      amount: 0n,
    },
  );
  assert.deepEqual(
    decodeShieldedNotePayload(encodeShieldedBudgetNotePayload({ ...budget, remaining: 0n })),
    { kind: "budget", ...budget, remaining: 0n },
  );
});

test("decrypted notes recompute exact on-chain commitments", async () => {
  const recipientPublicKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  for (const payload of [
    encodeShieldedValueNotePayload(value),
    encodeShieldedBudgetNotePayload(budget),
    encodeShieldedPolicyNotePayload(policy),
    encodeShieldedValueNotePayload(memoValue),
  ]) {
    const ciphertext = await encryptShieldedNote({ recipientPublicKey, payload, ...context });
    const recovered = await decryptShieldedNote({ hpkeIkm: keys.hpkeIkm, ciphertext, ...context });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    const expected = computeShieldedNoteCommitmentFromPayload({
      payload: recovered,
      ciphertextHashField,
    });
    assert.deepEqual(
      verifyShieldedNotePayload({
        payload: recovered,
        ciphertext,
        noteCommitment: expected.noteCommitment,
      }),
      expected,
    );
    assert.throws(
      () =>
        verifyShieldedNotePayload({
          payload: recovered,
          ciphertext,
          noteCommitment: expected.noteCommitment + 1n,
        }),
      (error) => error.code === "SHIELDED_NOTE_COMMITMENT_MISMATCH",
    );
  }
});

test("payload magic, version, type, length and field ranges are strict", () => {
  const payload = encodeShieldedValueNotePayload(value);
  const modified = (index, byte) => {
    const copy = payload.slice();
    copy[index] = byte;
    return copy;
  };
  assert.throws(
    () => decodeShieldedNotePayload(payload.subarray(0, 5)),
    (error) => error.code === "TRUNCATED_SHIELDED_NOTE",
  );
  assert.throws(
    () => decodeShieldedNotePayload(modified(0, 0)),
    (error) => error.code === "INVALID_SHIELDED_NOTE_MAGIC",
  );
  assert.throws(
    () => decodeShieldedNotePayload(modified(4, 2)),
    (error) => error.code === "UNSUPPORTED_SHIELDED_NOTE_VERSION",
  );
  assert.throws(
    () => decodeShieldedNotePayload(modified(5, 5)),
    (error) => error.code === "UNSUPPORTED_SHIELDED_NOTE_KIND",
  );
  assert.throws(
    () => decodeShieldedNotePayload(new Uint8Array([...payload, 0])),
    (error) => error.code === "INVALID_SHIELDED_NOTE_LENGTH",
  );
  const zeroNonce = payload.slice();
  zeroNonce.fill(0, zeroNonce.length - 32);
  assert.throws(
    () => decodeShieldedNotePayload(zeroNonce),
    (error) => error.code === "ZERO_SHIELDED_SECRET",
  );
  const badField = payload.slice();
  const field = SNARK_SCALAR_FIELD.toString(16).padStart(64, "0");
  badField.set(Buffer.from(field, "hex"), 6);
  assert.throws(
    () => decodeShieldedNotePayload(badField),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () => encodeShieldedValueNotePayload({
      ...value,
      topUpMemo: { budgetCommitment: 0n, budgetNote: budget },
    }),
    (error) => error.code === "ZERO_SHIELDED_BUDGET_COMMITMENT",
  );
  const badMemo = encodeShieldedValueNotePayload(memoValue);
  badMemo[SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32] = 0;
  assert.throws(
    () => decodeShieldedNotePayload(badMemo),
    (error) => error.code === "INVALID_SHIELDED_NOTE_MAGIC",
  );
});

test("budget codec rejects zero rates, fractional periods and oversized counts", () => {
  assert.throws(
    () => encodeShieldedBudgetNotePayload({ ...budget, amountPerPeriod: 0n }),
    (error) => error.code === "ZERO_SHIELDED_AMOUNT",
  );
  assert.throws(
    () => encodeShieldedBudgetNotePayload({ ...budget, remaining: 125n }),
    (error) => error.code === "FRACTIONAL_SHIELDED_BUDGET",
  );
  assert.throws(
    () => encodeShieldedBudgetNotePayload({ ...budget, amountPerPeriod: 1n, remaining: 1n << 64n }),
    (error) => error.code === "SHIELDED_PERIOD_COUNT_OVERFLOW",
  );
});
