import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_UINT32,
  MAX_UINT64,
  SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES,
  SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
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
  periodDays: 30n,
  remaining: 1200n,
  nonce: 31n,
};
const memoValue = {
  ...value,
  fundingMemo: { budgetCommitment: 71n, budgetNote: budget },
};

test("strict binary value and budget payloads round-trip within HPKE envelope", () => {
  const valuePayload = encodeShieldedValueNotePayload(value);
  const budgetPayload = encodeShieldedBudgetNotePayload(budget);
  const memoPayload = encodeShieldedValueNotePayload(memoValue);
  assert.equal(valuePayload.length, SHIELDED_VALUE_NOTE_PAYLOAD_BYTES);
  assert.equal(budgetPayload.length, SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES);
  assert.equal(memoPayload.length, SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES);
  assert.ok(memoPayload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.ok(budgetPayload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(valuePayload), { kind: "value", ...value });
  assert.deepEqual(decodeShieldedNotePayload(budgetPayload), { kind: "budget", ...budget });
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
  for (const unsupportedKind of [0, 6, 255]) {
    assert.throws(
      () => decodeShieldedNotePayload(modified(5, unsupportedKind)),
      (error) => error.code === "UNSUPPORTED_SHIELDED_NOTE_KIND",
    );
  }
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
    () =>
      encodeShieldedValueNotePayload({
        ...value,
        fundingMemo: { budgetCommitment: 0n, budgetNote: budget },
      }),
    (error) => error.code === "ZERO_SHIELDED_BUDGET_COMMITMENT",
  );
  const badMemo = encodeShieldedValueNotePayload(memoValue);
  badMemo[SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32] = 0;
  assert.deepEqual(decodeShieldedNotePayload(badMemo), { kind: "value", ...value });
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

test("budget payloads require explicit day periods and uint64 version indices", () => {
  for (const periodDays of [undefined, 0n, -1n, 1.5, MAX_UINT32 + 1n]) {
    assert.throws(() => encodeShieldedBudgetNotePayload({ ...budget, periodDays }));
  }
  const largest = { ...budget, periodDays: MAX_UINT32, rootVersionIndex: MAX_UINT64 };
  const payload = encodeShieldedBudgetNotePayload(largest);
  assert.deepEqual(decodeShieldedNotePayload(payload), { kind: "budget", ...largest });
  assert.throws(
    () => encodeShieldedBudgetNotePayload({ ...budget, rootVersionIndex: MAX_UINT64 + 1n }),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  const missingPeriod = payload.slice();
  missingPeriod.fill(0, payload.length - 4);
  assert.throws(
    () => decodeShieldedNotePayload(missingPeriod),
    (error) => error.code === "INVALID_SHIELDED_PERIOD",
  );
  // The retired 302-byte budget has neither the compact version field nor the day period.
  const oldLength = new Uint8Array(302);
  oldLength.set(payload);
  assert.throws(
    () => decodeShieldedNotePayload(oldLength),
    (error) => error.code === "INVALID_SHIELDED_NOTE_LENGTH",
  );
});

test("donor-only rule backup fits the fixed envelope and never becomes a note", () => {
  const ruleMemo = { ...memoValue, fundingMemo: { ...memoValue.fundingMemo, allocationKey: 41n } };
  const payload = encodeShieldedValueNotePayload(ruleMemo);
  assert.equal(payload.length, 432);
  assert.ok(payload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(payload), { kind: "value", ...ruleMemo });
  const malformedKey = payload.slice();
  malformedKey.fill(255, SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(malformedKey), { kind: "value", ...memoValue });
  assert.throws(
    () =>
      encodeShieldedValueNotePayload({
        ...ruleMemo,
        fundingMemo: { ...ruleMemo.fundingMemo, allocationKey: 42n },
      }),
    (error) => error.code === "INVALID_SHIELDED_ALLOCATION_KEY",
  );
});
