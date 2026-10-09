import assert from "node:assert/strict";
import test from "node:test";
import { poseidon3 } from "poseidon-lite";
import {
  SHIELDED_INHERITANCE_DOMAINS,
  computeShieldedPoolDomain,
  computeShieldedScopedPurpose,
  computeShieldedPolicyCommitment,
  computeShieldedAllocationKeyCommitment,
  computeShieldedEnrollmentCommitment,
  computeShieldedValueNoteCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedIdentityBudgetTermsCommitment,
  computeShieldedIdentityBudgetNoteCommitment,
  computeShieldedSpendNullifier,
  computeShieldedPeriodNullifier,
  computeShieldedDummyPeriodNullifier,
  computeShieldedDummyInputNullifier,
  computeShieldedBudgetUseNullifier,
  computeShieldedEnrollmentNullifier,
  computeShieldedCiphertextHashField,
  computeShieldedNoteCommitmentFromPayload,
  deriveShieldedHeirKeyMaterial,
  encodeShieldedValueNotePayload,
  encodeShieldedBudgetNotePayload,
  encodePublicShieldedBudgetEnvelope,
  decodeShieldedNotePayload,
  verifyShieldedNotePayload,
} from "../index.js";

const scope = { chainId: 1030n, poolAddress: "0x0000000000000000000000000000000000000001" };
const alternatives = [
  { ...scope, chainId: 71n },
  { ...scope, poolAddress: "0x0000000000000000000000000000000000000002" },
];
const keys = deriveShieldedHeirKeyMaterial(13n);
const policy = {
  rootIdentityCommitment: 11n,
  rootVersionIndex: 2n,
  amountPerPeriod: 100n,
  periodDays: 7n,
  policySalt: 17n,
  allocationKeyCommitment: 19n,
};
const terms = { ...policy, heirIdentityCommitment: 23n, eligibleFrom: 7200n };
const value = { ownerCommitment: keys.ownerCommitment, amount: 100n, nonce: 29n };
const budget = {
  policyCommitment: 31n,
  enrollmentCommitment: 37n,
  heirOwnerCommitment: keys.ownerCommitment,
  termsCommitment: 41n,
  amountPerPeriod: 100n,
  remaining: 300n,
  nonce: 43n,
  ciphertextHashField: 47n,
};

test("pool domains and purpose tags implement the independent 1031/1032 formulas", () => {
  const domain = poseidon3([1031n, scope.chainId, BigInt(scope.poolAddress)]);
  assert.equal(computeShieldedPoolDomain(scope), domain);
  for (const purpose of [
    1010n,
    1011n,
    1014n,
    1015n,
    1016n,
    1017n,
    1019n,
    1021n,
    1026n,
    1027n,
    1028n,
    1029n,
    1030n,
  ]) {
    assert.equal(computeShieldedScopedPurpose(purpose, scope), poseidon3([1032n, domain, purpose]));
  }
  assert.equal(SHIELDED_INHERITANCE_DOMAINS.poolScope, 1031n);
  assert.equal(SHIELDED_INHERITANCE_DOMAINS.scopedPurpose, 1032n);
});

test("every pool-local commitment and nullifier separates identical preimages across pools and chains", () => {
  const operations = [
    (ctx) => computeShieldedPolicyCommitment(policy, ctx),
    (ctx) => computeShieldedAllocationKeyCommitment(53n, ctx),
    (ctx) =>
      computeShieldedEnrollmentCommitment(
        {
          policyCommitment: 31n,
          heirIdentityCommitment: 23n,
          eligibleFrom: 7200n,
          enrollmentSalt: 59n,
        },
        ctx,
      ),
    (ctx) => computeShieldedValueNoteCommitment({ ...value, ciphertextHashField: 47n }, ctx),
    (ctx) => computeShieldedBudgetNoteCommitment(budget, ctx),
    (ctx) => computeShieldedIdentityBudgetTermsCommitment(terms, ctx),
    (ctx) => computeShieldedIdentityBudgetNoteCommitment(budget, ctx),
    (ctx) =>
      computeShieldedSpendNullifier({ ownerSecret: keys.ownerSecret, noteCommitment: 61n }, ctx),
    (ctx) =>
      computeShieldedPeriodNullifier(
        { derivedSecretField: 13n, policyCommitment: 31n, periodIndex: 2n },
        ctx,
      ),
    (ctx) =>
      computeShieldedDummyPeriodNullifier(
        { ownerSecret: keys.ownerSecret, budgetNoteCommitment: 61n, slotIndex: 3n },
        ctx,
      ),
    (ctx) =>
      computeShieldedDummyInputNullifier(
        { ownerSecret: keys.ownerSecret, noteCommitment: 61n },
        ctx,
      ),
    (ctx) =>
      computeShieldedBudgetUseNullifier(
        { policySalt: 17n, budgetNoteCommitment: 61n, useNonce: 67n },
        ctx,
      ),
    (ctx) =>
      computeShieldedEnrollmentNullifier(
        { allocationKey: 53n, policyCommitment: 31n, heirIdentityCommitment: 23n },
        ctx,
      ),
  ];
  for (const operation of operations) {
    const result = operation(scope);
    for (const alternative of alternatives) assert.notEqual(operation(alternative), result);
    assert.throws(() => operation(undefined));
  }
  assert.deepEqual(deriveShieldedHeirKeyMaterial(13n), keys);
});

test("chain and pool contexts are mandatory, nonzero and within the circuit bit bounds", () => {
  for (const invalid of [
    undefined,
    {},
    { ...scope, chainId: 0n },
    { ...scope, chainId: 1n << 64n },
    { ...scope, poolAddress: "0x0000000000000000000000000000000000000000" },
  ]) {
    assert.throws(() => computeShieldedPoolDomain(invalid));
    assert.throws(() => encodeShieldedValueNotePayload(value, invalid));
  }
});

test("public recovery and private value commitments cannot be rebound to a different context", () => {
  const publicBudget = {
    binding: "identity",
    rootIdentityCommitment: 11n,
    rootVersionIndex: 2n,
    heirIdentityCommitment: 23n,
    eligibleFrom: 7200n,
    amountPerPeriod: 100n,
    periodDays: 7n,
    policyCommitment: 31n,
    enrollmentCommitment: 37n,
    remaining: 300n,
    nonce: 43n,
  };
  const envelopes = [
    {
      payload: encodeShieldedValueNotePayload(value, scope),
      ciphertext: Uint8Array.from({ length: 512 }, () => 17),
    },
    {
      payload: encodeShieldedBudgetNotePayload(publicBudget, scope),
      ciphertext: encodePublicShieldedBudgetEnvelope(publicBudget, scope),
    },
  ];
  for (const { payload, ciphertext } of envelopes) {
    const { noteCommitment } = computeShieldedNoteCommitmentFromPayload(
      { payload, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
      scope,
    );
    assert.equal(
      verifyShieldedNotePayload({ payload, ciphertext, noteCommitment }, scope).noteCommitment,
      noteCommitment,
    );
    for (const alternative of alternatives)
      assert.throws(
        () => verifyShieldedNotePayload({ payload, ciphertext, noteCommitment }, alternative),
        (error) => error.code === "SHIELDED_NOTE_COMMITMENT_MISMATCH",
      );
  }
});

test("a donor backup uses the same scope for its nested rule and allocation key", () => {
  const privateBudget = {
    ...terms,
    allocationKeyCommitment: computeShieldedAllocationKeyCommitment(53n, scope),
    enrollmentSalt: 59n,
    heirOwnerCommitment: keys.ownerCommitment,
    remaining: 300n,
    nonce: 43n,
  };
  const payload = encodeShieldedValueNotePayload(
    {
      ...value,
      fundingMemo: {
        viewingKey: new Uint8Array(32).fill(7),
        budgetCommitment: 61n,
        budgetNote: privateBudget,
        allocationKey: 53n,
      },
    },
    scope,
  );
  assert.equal(payload.length, 459);
  assert.equal(decodeShieldedNotePayload(payload, scope).fundingMemo.allocationKey, 53n);
  for (const alternative of alternatives) {
    assert.throws(
      () => encodeShieldedValueNotePayload(decodeShieldedNotePayload(payload, scope), alternative),
      (error) => error.code === "INVALID_SHIELDED_ALLOCATION_KEY",
    );
  }
});
