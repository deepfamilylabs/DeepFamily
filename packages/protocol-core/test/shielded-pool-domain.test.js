import assert from "node:assert/strict";
import test from "node:test";
import { poseidon3 } from "poseidon-lite";
import { computeShieldedPoolDomain, computeShieldedScopedPurpose, computePolicyCommitment,
  computeShieldedAllocationKeyCommitment, computeShieldedValueNoteCommitment, computeShieldedSpendNullifier,
  encodeShieldedValueNotePayload, computeShieldedCiphertextHashField, computeShieldedNoteCommitmentFromPayload,
  verifyShieldedNotePayload } from "../index.js";

const scope = { chainId: 1030n, poolAddress: "0x0000000000000000000000000000000000000001" };
const alternatives = [{ ...scope, chainId: 71n }, { ...scope, poolAddress: "0x0000000000000000000000000000000000000002" }];
const value = { ownerCommitment: 13n, amount: 100n, nonce: 29n };
const policy = {familyCommitment: 11n, parentVersion: 2n, rate: 100n, periodDays: 7n, policySalt: 17n, allocationKeyCommitment: 19n};

test("pool domain and purpose tags implement the 1031/1032 formulas", () => {
  const domain = poseidon3([1031n, scope.chainId, BigInt(scope.poolAddress)]);
  assert.equal(computeShieldedPoolDomain(scope), domain);
  for (const purpose of [1010n, 1014n, 1016n, 1017n, 1021n, 1028n, 75001n, 75002n])
    assert.equal(computeShieldedScopedPurpose(purpose, scope), poseidon3([1032n, domain, purpose]));
});

test("ledger commitments and nullifiers separate identical openings across chains and pools", () => {
  for (const operation of [ctx => computePolicyCommitment(policy, ctx),
    ctx => computeShieldedAllocationKeyCommitment(53n, ctx),
    ctx => computeShieldedValueNoteCommitment({...value, ciphertextHashField: 47n}, ctx),
    ctx => computeShieldedSpendNullifier({ownerSecret: 13n, noteCommitment: 61n}, ctx)]) {
    for (const alternative of alternatives) assert.notEqual(operation(alternative), operation(scope));
    assert.throws(() => operation(undefined));
  }
});

test("value recovery authenticates exact ciphertext, plaintext, chain and pool", () => {
  const payload = encodeShieldedValueNotePayload(value, scope);
  const ciphertext = new Uint8Array(512).fill(17);
  const {noteCommitment} = computeShieldedNoteCommitmentFromPayload({payload, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext)}, scope);
  assert.equal(verifyShieldedNotePayload({payload, ciphertext, noteCommitment}, scope).noteCommitment, noteCommitment);
  for (const other of alternatives) assert.throws(() => verifyShieldedNotePayload({payload, ciphertext, noteCommitment}, other));
  const changed = ciphertext.slice(); changed[7] ^= 1;
  assert.throws(() => verifyShieldedNotePayload({payload, ciphertext: changed, noteCommitment}, scope));
});

test("contexts are mandatory, nonzero and bounded by the circuit widths", () => {
  for (const invalid of [undefined, {}, {...scope,chainId:0n}, {...scope,chainId:1n<<64n}, {...scope,poolAddress:"0x0000000000000000000000000000000000000000"}]) {
    assert.throws(() => computeShieldedPoolDomain(invalid));
    assert.throws(() => encodeShieldedValueNotePayload(value, invalid));
  }
});
