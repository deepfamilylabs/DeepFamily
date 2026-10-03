import test from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "ethers";
import {
  SHIELDED_HPKE_MAX_PAYLOAD_BYTES,
  SHIELDED_POOL_ACTION,
  SNARK_SCALAR_FIELD,
  buildShieldedPoolPublicInputs,
  computeShieldedAllocationKeyCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedIdentityBudgetNoteCommitment,
  computeShieldedNoteCommitmentFromPayload,
  computeShieldedPolicyCommitment,
  decodePublicShieldedBudgetEnvelope,
  decodeShieldedNotePayload,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodePublicShieldedBudgetEnvelope,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  getShieldedBudgetCommitments,
  getShieldedPublicBudgetFields,
  isPublicShieldedBudgetEnvelope,
  verifyShieldedNotePayload,
} from "../index.js";

const context = { chainId: 1030n, poolAddress: "0x0000000000000000000000000000000000000001" };
const keys = deriveShieldedHeirKeyMaterial(13n);
const ruleOpening = {
  policySalt: 17n,
  allocationKeyCommitment: computeShieldedAllocationKeyCommitment(41n),
  enrollmentSalt: 23n,
};
const common = {
  rootIdentityCommitment: 11n,
  rootVersionIndex: 2n,
  heirIdentityCommitment: 19n,
  amountPerPeriod: 100n,
  eligibleFrom: 2592001n,
  remaining: 1200n,
  nonce: 31n,
};
const policyCommitment = computeShieldedPolicyCommitment({ ...common, ...ruleOpening });
const enrollmentCommitment = computeShieldedEnrollmentCommitment({
  ...common,
  ...ruleOpening,
  policyCommitment,
});
const budget = { binding: "identity", ...common, policyCommitment, enrollmentCommitment };
const privateBudget = { ...common, ...ruleOpening, heirOwnerCommitment: keys.ownerCommitment };
const value = { ownerCommitment: keys.ownerCommitment, amount: 300n, nonce: 29n };

test("new identity schema is compact and leaves the exact private encoding unchanged", () => {
  const payload = encodeShieldedBudgetNotePayload(budget);
  assert.equal(payload.length, 214);
  assert.equal(payload[5], 5);
  assert.equal(
    keccak256(payload),
    "0x016d1329f89d488c439464ea528a2636c45a7d0b57770787c0c681fcd1d3dbff",
  );
  assert.deepEqual(decodeShieldedNotePayload(payload), { kind: "budget", ...budget });
  const original = encodeShieldedBudgetNotePayload(privateBudget);
  assert.equal(original.length, 302);
  assert.equal(original[5], 2);
  assert.equal(
    keccak256(original),
    "0xb284504956b131aac51597f48425209c2abd3a7c699e06eda0ae574b1186aff6",
  );
  assert.deepEqual(
    encodeShieldedBudgetNotePayload({ ...privateBudget, binding: "owner" }),
    original,
  );
  assert.deepEqual(getShieldedBudgetCommitments(privateBudget), {
    policyCommitment,
    enrollmentCommitment,
  });
  assert.equal(
    getShieldedBudgetCommitments(budget).termsCommitment,
    9980545081748734662767974432142644277902528624697066622707057929322913558581n,
  );
});

test("public envelope has no private opening or authorization fields and requires canonical padding", () => {
  const envelope = encodePublicShieldedBudgetEnvelope(budget);
  assert.equal(envelope.length, 512);
  assert.ok(envelope.subarray(214).every((byte) => byte === 0));
  assert.ok(isPublicShieldedBudgetEnvelope(envelope));
  assert.deepEqual(decodePublicShieldedBudgetEnvelope(envelope), { kind: "budget", ...budget });
  for (const field of [
    "policySalt",
    "enrollmentSalt",
    "allocationKeyCommitment",
    "allocationKey",
    "heirOwnerCommitment",
    "ownerSecret",
    "ruleOpening",
    "fundingMemo",
  ]) {
    assert.throws(
      () => encodePublicShieldedBudgetEnvelope({ ...budget, [field]: 1n }),
      (error) => error.code === "PRIVATE_SHIELDED_BUDGET_FIELD",
    );
  }
  assert.throws(
    () => encodePublicShieldedBudgetEnvelope(privateBudget),
    (error) => error.code === "INVALID_SHIELDED_BUDGET_BINDING",
  );
  assert.equal(decodePublicShieldedBudgetEnvelope(new Uint8Array(512).fill(0x22)), null);
  const badPadding = envelope.slice();
  badPadding[511] = 1;
  assert.throws(
    () => decodePublicShieldedBudgetEnvelope(badPadding),
    (error) => error.code === "INVALID_SHIELDED_PUBLIC_BUDGET_PADDING",
  );
  assert.throws(
    () => decodePublicShieldedBudgetEnvelope(envelope.subarray(0, 511)),
    (error) => error.code === "INVALID_SHIELDED_CIPHERTEXT_LENGTH",
  );
  const badVersion = envelope.slice();
  badVersion[4] = 2;
  assert.ok(isPublicShieldedBudgetEnvelope(badVersion));
  assert.throws(
    () => decodePublicShieldedBudgetEnvelope(badVersion),
    (error) => error.code === "UNSUPPORTED_SHIELDED_NOTE_VERSION",
  );
});

test("identity commitment binds recipient, every term, amount and opaque rule commitments", () => {
  const payload = encodeShieldedBudgetNotePayload(budget);
  const envelope = encodePublicShieldedBudgetEnvelope(budget);
  const ciphertextHashField = computeShieldedCiphertextHashField(envelope);
  const result = computeShieldedNoteCommitmentFromPayload({ payload, ciphertextHashField });
  assert.equal(
    result.noteCommitment,
    9262915699632282721577147844082196561357613697609114593894190525331603550321n,
  );
  assert.deepEqual(
    verifyShieldedNotePayload({
      payload,
      ciphertext: envelope,
      noteCommitment: result.noteCommitment,
    }),
    result,
  );
  for (const field of [
    "rootIdentityCommitment",
    "rootVersionIndex",
    "heirIdentityCommitment",
    "amountPerPeriod",
    "eligibleFrom",
    "policyCommitment",
    "enrollmentCommitment",
    "remaining",
    "nonce",
  ]) {
    const changed = {
      ...budget,
      [field]: budget[field] + (field === "amountPerPeriod" || field === "remaining" ? 100n : 1n),
    };
    const changedPayload = encodeShieldedBudgetNotePayload(changed);
    assert.throws(
      () =>
        verifyShieldedNotePayload({
          payload: changedPayload,
          ciphertext: envelope,
          noteCommitment: result.noteCommitment,
        }),
      (error) => error.code === "SHIELDED_NOTE_COMMITMENT_MISMATCH",
    );
  }
  const originalCommitment = computeShieldedNoteCommitmentFromPayload({
    payload: encodeShieldedBudgetNotePayload(privateBudget),
    ciphertextHashField,
  });
  assert.notEqual(result.noteCommitment, originalCommitment.noteCommitment);
  assert.equal(
    computeShieldedIdentityBudgetNoteCommitment({
      ...budget,
      ...getShieldedBudgetCommitments(budget),
      ciphertextHashField,
    }),
    result.noteCommitment,
  );
  for (const changed of [
    { rootVersionIndex: 1n << 64n },
    { policyCommitment: SNARK_SCALAR_FIELD },
    { enrollmentCommitment: 0n },
    { nonce: 0n },
    { amountPerPeriod: 0n },
    { remaining: 1n },
    { amountPerPeriod: 1n, remaining: 1n << 64n },
  ])
    assert.throws(() => encodeShieldedBudgetNotePayload({ ...budget, ...changed }));
});

test("identity budgets and donor backups fit HPKE and private openings stay in donor ciphertext", async () => {
  const recipientPublicKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  for (const allocationKey of [undefined, 41n]) {
    const fundingMemo = {
      budgetCommitment: 71n,
      budgetNote: budget,
      ruleOpening,
      ...(allocationKey === undefined ? {} : { allocationKey }),
    };
    const memo = { ...value, fundingMemo };
    const payload = encodeShieldedValueNotePayload(memo);
    assert.equal(payload.length, allocationKey === undefined ? 428 : 460);
    assert.ok(payload.length <= SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
    assert.deepEqual(decodeShieldedNotePayload(payload), { kind: "value", ...memo });
    const ciphertext = await encryptShieldedNote({ recipientPublicKey, payload, ...context });
    const recovered = await decryptShieldedNote({ hpkeIkm: keys.hpkeIkm, ciphertext, ...context });
    assert.deepEqual(recovered, payload);
    assert.equal(decodePublicShieldedBudgetEnvelope(ciphertext), null);
    const badOpening = payload.slice();
    badOpening.fill(0, 332, 364);
    assert.deepEqual(decodeShieldedNotePayload(badOpening), { kind: "value", ...value });
    if (allocationKey !== undefined) {
      const badKey = payload.slice();
      badKey.fill(255, 428);
      assert.deepEqual(decodeShieldedNotePayload(badKey), {
        kind: "value",
        ...value,
        fundingMemo: { budgetCommitment: 71n, budgetNote: budget, ruleOpening },
      });
    }
  }
  const identityPayload = encodeShieldedBudgetNotePayload(budget);
  const ciphertext = await encryptShieldedNote({
    recipientPublicKey,
    payload: identityPayload,
    ...context,
  });
  assert.deepEqual(
    decodeShieldedNotePayload(
      await decryptShieldedNote({ hpkeIkm: keys.hpkeIkm, ciphertext, ...context }),
    ),
    { kind: "budget", ...budget },
  );
  const memo = { budgetCommitment: 71n, budgetNote: budget, ruleOpening };
  assert.throws(
    () =>
      encodeShieldedValueNotePayload({
        ...value,
        fundingMemo: { ...memo, ruleOpening: undefined },
      }),
    (error) => error.code === "MISSING_SHIELDED_RULE_OPENING",
  );
  assert.throws(
    () =>
      encodeShieldedValueNotePayload({
        ...value,
        fundingMemo: { ...memo, ruleOpening: { ...ruleOpening, enrollmentSalt: 24n } },
      }),
    (error) => error.code === "INVALID_SHIELDED_RULE_OPENING",
  );
  assert.throws(
    () =>
      encodeShieldedValueNotePayload({ ...value, fundingMemo: { ...memo, allocationKey: 42n } }),
    (error) => error.code === "INVALID_SHIELDED_ALLOCATION_KEY",
  );
});

test("public fund signal fields come from the canonical output while claim exposes no recipient or binding kind", () => {
  const envelope = encodePublicShieldedBudgetEnvelope(budget);
  const privateEnvelope = new Uint8Array(512).fill(0x22);
  const base = {
    ...context,
    action: SHIELDED_POOL_ACTION.Fund,
    fundMode: 0,
    budgetKind: 1,
    inputShardIds: [2, 2],
    inputRoots: [11, 11],
    inputNullifiers: [13, 14],
    periodNullifiers: Array(12).fill(0),
    outputCommitments: [27, 28],
    outputCiphertexts: [envelope, privateEnvelope],
    relation0: 29,
    relation1: 30,
    asOf: 31,
  };
  const { signals, witness } = buildShieldedPoolPublicInputs(base);
  const publicBudget = getShieldedPublicBudgetFields(budget);
  assert.equal(signals.length, 26);
  assert.deepEqual(signals.slice(0, 13), [1030n, 1n, 0n, 1n, ...publicBudget]);
  assert.deepEqual(witness.publicBudget, publicBudget.map(String));
  assert.throws(
    () => buildShieldedPoolPublicInputs({ ...base, publicBudget: [12n, ...publicBudget.slice(1)] }),
    (error) => error.code === "INVALID_SHIELDED_PUBLIC_BUDGET",
  );
  assert.throws(
    () =>
      buildShieldedPoolPublicInputs({
        ...base,
        outputCiphertexts: [privateEnvelope, privateEnvelope],
      }),
    (error) => error.code === "INVALID_SHIELDED_PUBLIC_BUDGET",
  );
  assert.throws(
    () => buildShieldedPoolPublicInputs({ ...base, budgetKind: 0, publicBudget }),
    (error) => error.code === "INVALID_SHIELDED_PUBLIC_BUDGET",
  );
  assert.throws(
    () => buildShieldedPoolPublicInputs({ ...base, action: SHIELDED_POOL_ACTION.Claim }),
    (error) => error.code === "INVALID_SHIELDED_ACTION_DATA",
  );
  const claim = buildShieldedPoolPublicInputs({
    ...base,
    action: SHIELDED_POOL_ACTION.Claim,
    budgetKind: 0,
    outputCiphertexts: [privateEnvelope, privateEnvelope],
  });
  assert.equal(claim.signals.length, 27);
  assert.equal("budgetKind" in claim.witness, false);
  assert.equal("publicBudget" in claim.witness, false);
});
