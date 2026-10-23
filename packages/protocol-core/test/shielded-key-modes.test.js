import assert from "node:assert/strict";
import test from "node:test";
import {
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  decodeShieldedNotePayload,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  deriveShieldedIndependentKeyMaterial,
  getShieldedBudgetCommitments,
  deriveShieldedHeirKeyMaterial,
} from "../index.js";
const scope = {
  viewingKey: "0x" + "11".repeat(32),
  chainId: 1030n,
  poolAddress: "0x1111111111111111111111111111111111111111",
};
const legacy = deriveShieldedHeirKeyMaterial(123n);
const note = {
  viewingKey: scope.viewingKey,
  budgetOrigin: 0n,
  rootIdentityCommitment: 11n,
  rootVersionIndex: 1n,
  policySalt: 12n,
  allocationKeyCommitment: computeShieldedAllocationKeyCommitment(13n, scope),
  heirIdentityCommitment: 14n,
  eligibleFrom: 15n,
  enrollmentSalt: 16n,
  heirOwnerCommitment: legacy.ownerCommitment,
  amountPerPeriod: 100n,
  remaining: 1200n,
  nonce: 17n,
  periodDays: 30n,
  keyMode: 0n,
};

test("private modes alter owner authorization while retaining policy and enrollment", () => {
  const rootNote = { ...note, keyMode: 1n };
  const commitments = getShieldedBudgetCommitments(note, scope);
  assert.deepEqual(getShieldedBudgetCommitments(rootNote, scope), commitments);
  assert.notEqual(
    computeShieldedBudgetNoteCommitment(
      { ...note, ...commitments, ciphertextHashField: 19n },
      scope,
    ),
    computeShieldedBudgetNoteCommitment(
      { ...rootNote, ...commitments, ciphertextHashField: 19n },
      scope,
    ),
  );
  assert.equal(
    decodeShieldedNotePayload(encodeShieldedBudgetNotePayload(rootNote, scope), scope).keyMode,
    1n,
  );
  const invalid = encodeShieldedBudgetNotePayload(rootNote, scope);
  invalid[invalid.length - 1] = 2;
  assert.throws(() => decodeShieldedNotePayload(invalid, scope));
  assert.throws(() =>
    encodeShieldedBudgetNotePayload({ ...rootNote, rootSource: "random" }, scope),
  );
  assert.throws(() => getShieldedBudgetCommitments({ binding: "identity", keyMode: 1n }, scope));
});

test("private funding backup carries the mode and original viewing key within 460 bytes", async () => {
  const root = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot: new Uint8Array(32).fill(7),
    independentKeyIdentitySecret: new Uint8Array(32).fill(3),
  });
  const budgetNote = {
    ...note,
    viewingKey: root.viewPublicKey,
    keyMode: 1n,
    heirOwnerCommitment: root.ownerCommitment,
  };
  const payload = encodeShieldedValueNotePayload(
    {
      ownerCommitment: legacy.ownerCommitment,
      amount: 0n,
      nonce: 23n,
      fundingMemo: {
        budgetCommitment: 29n,
        budgetNote,
        allocationKey: 13n,
        viewingKey: root.viewPublicKey,
      },
    },
    scope,
  );
  assert.equal(payload.length, 460);
  const restored = decodeShieldedNotePayload(payload, scope);
  assert.equal(restored.fundingMemo.budgetNote.keyMode, 1n);
  assert.equal(restored.fundingMemo.allocationKey, 13n);
  assert.equal(
    restored.fundingMemo.viewingKey,
    "0x" + Buffer.from(root.viewPublicKey).toString("hex"),
  );
});
