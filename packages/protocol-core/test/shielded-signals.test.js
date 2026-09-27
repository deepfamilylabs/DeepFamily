import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShieldedKeyRegistrationPublicSignals,
  buildShieldedPoolPublicSignals,
  computeShieldedCiphertextHashField,
  computeShieldedRegistrationTag,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  SHIELDED_POOL_PUBLIC_SIGNAL_COUNT,
} from "../index.js";

const ciphertextA = Uint8Array.from({ length: 512 }, () => 0x11);
const ciphertextB = Uint8Array.from({ length: 512 }, () => 0x22);

test("pool public signal order matches the immutable 32-signal Solidity ABI", () => {
  const signals = buildShieldedPoolPublicSignals({
    action: 5,
    chainId: 1030,
    poolAddress: "0x0000000000000000000000000000000000000001",
    inputShardIds: [2, 3],
    inputRoots: [11, 12],
    inputNullifiers: [13, 14],
    periodNullifiers: Array.from({ length: 12 }, (_, i) => i + 15),
    outputCommitments: [27, 28],
    outputCiphertexts: [ciphertextA, ciphertextB],
    relation0: 29,
    relation1: 30,
    asOf: 31,
    registryRoot: 32,
    registryShardId: 33,
  });
  assert.equal(signals.length, SHIELDED_POOL_PUBLIC_SIGNAL_COUNT);
  assert.deepEqual(signals.slice(0, 9), [5n, 1030n, 1n, 2n, 11n, 3n, 12n, 13n, 14n]);
  assert.deepEqual(
    signals.slice(9, 21),
    Array.from({ length: 12 }, (_, i) => BigInt(i + 15)),
  );
  assert.deepEqual(signals.slice(21), [
    27n,
    28n,
    computeShieldedCiphertextHashField(ciphertextA),
    computeShieldedCiphertextHashField(ciphertextB),
    0n,
    0n,
    29n,
    30n,
    31n,
    32n,
    33n,
  ]);
  assert.throws(
    () =>
      buildShieldedPoolPublicSignals({
        action: 5,
        chainId: 1030,
        poolAddress: "0x0000000000000000000000000000000000000001",
        inputShardIds: [0, 0],
        inputRoots: [0, 0],
        inputNullifiers: [0, 0],
        periodNullifiers: [0],
        outputCommitments: [1, 2],
        outputCiphertexts: [ciphertextA, ciphertextB],
      }),
    (error) => error.code === "INVALID_SHIELDED_SIGNAL_SHAPE",
  );
});

test("registration public signals bind the exact HPKE public key limbs", async () => {
  const derivedSecretField = 13n;
  const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const input = {
    derivedSecretField,
    identityCommitment: 19n,
    ownerCommitment: keys.ownerCommitment,
    viewingKey,
    chainId: 1030n,
    registryAddress: "0x0000000000000000000000000000000000000001",
  };
  const signals = buildShieldedKeyRegistrationPublicSignals(input);
  assert.equal(signals.length, 7);
  assert.equal(signals[0], 19n);
  assert.equal(signals[1], keys.ownerCommitment);
  assert.equal(
    signals[6],
    computeShieldedRegistrationTag({
      ...input,
      viewKeyLo: signals[2],
      viewKeyHi: signals[3],
    }),
  );
});
