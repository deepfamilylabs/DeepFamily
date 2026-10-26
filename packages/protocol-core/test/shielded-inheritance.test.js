import test from "node:test";
import assert from "node:assert/strict";
import { poseidon2, poseidon3, poseidon5, poseidon7 } from "poseidon-lite";
import {
  computeShieldedOwnerCommitment,
  computeShieldedValueNoteCommitment,
  computeShieldedSpendNullifier,
  computePolicyCommitment,
  computeShieldedScopedPurpose,
  computeShieldedCiphertextHashField,
  generateShieldedRandomField,
} from "../index.js";
import { MAX_UINT128, SNARK_SCALAR_FIELD } from "../constants.js";
const scope = { chainId: 31337n, poolAddress: "0x0000000000000000000000000000000000001234" };

test("ledger formulas bind the owner, note opening and authenticated ciphertext", () => {
  const owner = computeShieldedOwnerCommitment(13n);
  assert.equal(owner, poseidon2([1013n, 13n]));
  const commitment = computeShieldedValueNoteCommitment(
    { ownerCommitment: owner, amount: 10n, nonce: 17n, ciphertextHashField: 19n },
    scope,
  );
  assert.equal(
    commitment,
    poseidon5([computeShieldedScopedPurpose(1014n, scope), owner, 10n, 17n, 19n]),
  );
  assert.equal(
    computeShieldedSpendNullifier({ ownerSecret: 13n, noteCommitment: commitment }, scope),
    poseidon3([computeShieldedScopedPurpose(1016n, scope), 13n, commitment]),
  );
  assert.notEqual(
    computeShieldedSpendNullifier({ ownerSecret: 14n, noteCommitment: commitment }, scope),
    computeShieldedSpendNullifier({ ownerSecret: 13n, noteCommitment: commitment }, scope),
  );
});

test("policy commitment includes every rule field and a pool-specific domain", () => {
  const policy = {
    familyCommitment: 11n,
    parentVersion: 2n,
    rate: 100n,
    periodDays: 7n,
    policySalt: 17n,
    allocationKeyCommitment: 19n,
  };
  const expected = poseidon7([
    computeShieldedScopedPurpose(1010n, scope),
    11n,
    2n,
    100n,
    17n,
    19n,
    7n,
  ]);
  assert.equal(computePolicyCommitment(policy, scope), expected);
  for (const key of Object.keys(policy))
    assert.notEqual(
      computePolicyCommitment({ ...policy, [key]: policy[key] + 1n }, scope),
      expected,
    );
});

test("secrets, amounts and ciphertexts obey the circuit bounds", () => {
  const note = { ownerCommitment: 13n, amount: 0n, nonce: 17n, ciphertextHashField: 19n };
  assert(computeShieldedValueNoteCommitment(note, scope) > 0n);
  assert(computeShieldedValueNoteCommitment({ ...note, amount: MAX_UINT128 }, scope) > 0n);
  for (const invalid of [
    { ...note, ownerCommitment: 0n },
    { ...note, nonce: 0n },
    { ...note, amount: MAX_UINT128 + 1n },
    { ...note, ciphertextHashField: SNARK_SCALAR_FIELD },
  ])
    assert.throws(() => computeShieldedValueNoteCommitment(invalid, scope));
  for (const value of [new Uint8Array(), new Uint8Array(511), new Uint8Array(513)])
    assert.throws(() => computeShieldedCiphertextHashField(value));
  const fields = Array.from({ length: 8 }, generateShieldedRandomField);
  assert(fields.every((value) => value > 0n && value < SNARK_SCALAR_FIELD));
  assert.equal(new Set(fields).size, fields.length);
});
