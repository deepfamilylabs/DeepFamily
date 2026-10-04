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
  allocationKeyCommitment: computeShieldedAllocationKeyCommitment(41n, context),
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
  const valuePayload = encodeShieldedValueNotePayload(value, context);
  const budgetPayload = encodeShieldedBudgetNotePayload(budget, context);
  const memoPayload = encodeShieldedValueNotePayload(memoValue, context);
  assert.equal(valuePayload.length, SHIELDED_VALUE_NOTE_PAYLOAD_BYTES);
  assert.equal(budgetPayload.length, SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES);
  assert.equal(memoPayload.length, SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES);
  assert.ok(memoPayload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.ok(budgetPayload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(valuePayload, context), { kind: "value", ...value });
  assert.deepEqual(decodeShieldedNotePayload(budgetPayload, context), {
    kind: "budget",
    ...budget,
  });
  assert.deepEqual(decodeShieldedNotePayload(memoPayload, context), {
    kind: "value",
    ...memoValue,
  });
  assert.deepEqual(
    decodeShieldedNotePayload(
      encodeShieldedValueNotePayload({ ...value, amount: 0n }, context),
      context,
    ),
    {
      kind: "value",
      ...value,
      amount: 0n,
    },
  );
  assert.deepEqual(
    decodeShieldedNotePayload(
      encodeShieldedBudgetNotePayload({ ...budget, remaining: 0n }, context),
      context,
    ),
    { kind: "budget", ...budget, remaining: 0n },
  );
});

test("decrypted notes recompute exact on-chain commitments", async () => {
  const recipientPublicKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  for (const payload of [
    encodeShieldedValueNotePayload(value, context),
    encodeShieldedBudgetNotePayload(budget, context),
    encodeShieldedValueNotePayload(memoValue, context),
  ]) {
    const ciphertext = await encryptShieldedNote({ recipientPublicKey, payload, ...context });
    const recovered = await decryptShieldedNote({ hpkeIkm: keys.hpkeIkm, ciphertext, ...context });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    const expected = computeShieldedNoteCommitmentFromPayload(
      {
        payload: recovered,
        ciphertextHashField,
      },
      context,
    );
    assert.deepEqual(
      verifyShieldedNotePayload(
        {
          payload: recovered,
          ciphertext,
          noteCommitment: expected.noteCommitment,
        },
        context,
      ),
      expected,
    );
    assert.throws(
      () =>
        verifyShieldedNotePayload(
          {
            payload: recovered,
            ciphertext,
            noteCommitment: expected.noteCommitment + 1n,
          },
          context,
        ),
      (error) => error.code === "SHIELDED_NOTE_COMMITMENT_MISMATCH",
    );
  }
});

test("payload magic, version, type, length and field ranges are strict", () => {
  const payload = encodeShieldedValueNotePayload(value, context);
  const modified = (index, byte) => {
    const copy = payload.slice();
    copy[index] = byte;
    return copy;
  };
  assert.throws(
    () => decodeShieldedNotePayload(payload.subarray(0, 5), context),
    (error) => error.code === "TRUNCATED_SHIELDED_NOTE",
  );
  assert.throws(
    () => decodeShieldedNotePayload(modified(0, 0), context),
    (error) => error.code === "INVALID_SHIELDED_NOTE_MAGIC",
  );
  assert.throws(
    () => decodeShieldedNotePayload(modified(4, 1), context),
    (error) => error.code === "UNSUPPORTED_SHIELDED_NOTE_VERSION",
  );
  for (const unsupportedKind of [0, 6, 255]) {
    assert.throws(
      () => decodeShieldedNotePayload(modified(5, unsupportedKind), context),
      (error) => error.code === "UNSUPPORTED_SHIELDED_NOTE_KIND",
    );
  }
  assert.throws(
    () => decodeShieldedNotePayload(new Uint8Array([...payload, 0]), context),
    (error) => error.code === "INVALID_SHIELDED_NOTE_LENGTH",
  );
  const zeroNonce = payload.slice();
  zeroNonce.fill(0, zeroNonce.length - 32);
  assert.throws(
    () => decodeShieldedNotePayload(zeroNonce, context),
    (error) => error.code === "ZERO_SHIELDED_SECRET",
  );
  const badField = payload.slice();
  const field = SNARK_SCALAR_FIELD.toString(16).padStart(64, "0");
  badField.set(Buffer.from(field, "hex"), 6);
  assert.throws(
    () => decodeShieldedNotePayload(badField, context),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  assert.throws(
    () =>
      encodeShieldedValueNotePayload(
        {
          ...value,
          fundingMemo: { budgetCommitment: 0n, budgetNote: budget },
        },
        context,
      ),
    (error) => error.code === "ZERO_SHIELDED_BUDGET_COMMITMENT",
  );
  const badMemo = encodeShieldedValueNotePayload(memoValue, context);
  badMemo[SHIELDED_VALUE_NOTE_PAYLOAD_BYTES + 32] = 0;
  assert.deepEqual(decodeShieldedNotePayload(badMemo, context), { kind: "value", ...value });
});

test("budget codec rejects zero rates, fractional periods and oversized counts", () => {
  assert.throws(
    () => encodeShieldedBudgetNotePayload({ ...budget, amountPerPeriod: 0n }, context),
    (error) => error.code === "ZERO_SHIELDED_AMOUNT",
  );
  assert.throws(
    () => encodeShieldedBudgetNotePayload({ ...budget, remaining: 125n }, context),
    (error) => error.code === "FRACTIONAL_SHIELDED_BUDGET",
  );
  assert.throws(
    () =>
      encodeShieldedBudgetNotePayload(
        { ...budget, amountPerPeriod: 1n, remaining: 1n << 64n },
        context,
      ),
    (error) => error.code === "SHIELDED_PERIOD_COUNT_OVERFLOW",
  );
});

test("budget payloads require explicit day periods and uint64 version indices", () => {
  for (const periodDays of [undefined, 0n, -1n, 1.5, MAX_UINT32 + 1n]) {
    assert.throws(() => encodeShieldedBudgetNotePayload({ ...budget, periodDays }, context));
  }
  const largest = { ...budget, periodDays: MAX_UINT32, rootVersionIndex: MAX_UINT64 };
  const payload = encodeShieldedBudgetNotePayload(largest, context);
  assert.deepEqual(decodeShieldedNotePayload(payload, context), { kind: "budget", ...largest });
  assert.throws(
    () =>
      encodeShieldedBudgetNotePayload({ ...budget, rootVersionIndex: MAX_UINT64 + 1n }, context),
    (error) => error.code === "INTEGER_OUT_OF_RANGE",
  );
  const missingPeriod = payload.slice();
  missingPeriod.fill(0, payload.length - 4);
  assert.throws(
    () => decodeShieldedNotePayload(missingPeriod, context),
    (error) => error.code === "INVALID_SHIELDED_PERIOD",
  );
  // The retired 302-byte budget has neither the compact version field nor the day period.
  const oldLength = new Uint8Array(302);
  oldLength.set(payload);
  assert.throws(
    () => decodeShieldedNotePayload(oldLength, context),
    (error) => error.code === "INVALID_SHIELDED_NOTE_LENGTH",
  );
});

test("donor-only rule backup fits the fixed envelope and never becomes a note", () => {
  const ruleMemo = { ...memoValue, fundingMemo: { ...memoValue.fundingMemo, allocationKey: 41n } };
  const payload = encodeShieldedValueNotePayload(ruleMemo, context);
  assert.equal(payload.length, 432);
  assert.ok(payload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(payload, context), { kind: "value", ...ruleMemo });
  const malformedKey = payload.slice();
  malformedKey.fill(255, SHIELDED_VALUE_WITH_BUDGET_MEMO_PAYLOAD_BYTES);
  assert.deepEqual(decodeShieldedNotePayload(malformedKey, context), {
    kind: "value",
    ...memoValue,
  });
  assert.throws(
    () =>
      encodeShieldedValueNotePayload(
        {
          ...ruleMemo,
          fundingMemo: { ...ruleMemo.fundingMemo, allocationKey: 42n },
        },
        context,
      ),
    (error) => error.code === "INVALID_SHIELDED_ALLOCATION_KEY",
  );
});
