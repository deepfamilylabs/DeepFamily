import assert from "node:assert/strict";
import test from "node:test";
import {
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedReceiveCodeFingerprint,
  buildShieldedReceiveCodePublicSignals,
  decodeShieldedNotePayload,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  deriveShieldedAssetKeyMaterial,
  getShieldedBudgetCommitments,
  deriveShieldedHeirKeyMaterial,
} from "../index.js";
const scope = { chainId: 1030n, poolAddress: "0x1111111111111111111111111111111111111111" };
const legacy = deriveShieldedHeirKeyMaterial(123n);
const note = {
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

test("private funding backup carries the mode and original viewing key within 459 bytes", async () => {
  const root = await deriveShieldedAssetKeyMaterial(new Uint8Array(32).fill(7));
  const budgetNote = { ...note, keyMode: 1n, heirOwnerCommitment: root.ownerCommitment };
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
  assert.equal(payload.length, 459);
  const restored = decodeShieldedNotePayload(payload, scope);
  assert.equal(restored.fundingMemo.budgetNote.keyMode, 1n);
  assert.equal(restored.fundingMemo.allocationKey, 13n);
  assert.equal(
    restored.fundingMemo.viewingKey,
    "0x" + Buffer.from(root.viewPublicKey).toString("hex"),
  );
});

test("receive-code fingerprint binds the proved mode, identity and view but no root source or proof", async () => {
  const keys = await deriveShieldedAssetKeyMaterial(new Uint8Array(32).fill(8));
  const input = {
    identityCommitment: 14n,
    ownerCommitment: keys.ownerCommitment,
    viewingKey: keys.viewPublicKey,
    keyMode: 1n,
  };
  const fingerprint = computeShieldedReceiveCodeFingerprint(input);
  assert.equal(buildShieldedReceiveCodePublicSignals(input).length, 9);
  assert.equal(
    fingerprint,
    computeShieldedReceiveCodeFingerprint({ ...input, rootSource: "random", proof: "unbound" }),
  );
  assert.notEqual(fingerprint, computeShieldedReceiveCodeFingerprint({ ...input, keyMode: 0n }));
  assert.notEqual(
    fingerprint,
    computeShieldedReceiveCodeFingerprint({ ...input, identityCommitment: 15n }),
  );
  assert.throws(() =>
    buildShieldedReceiveCodePublicSignals({ ...input, assetDerivationVersion: 2 }),
  );
});
