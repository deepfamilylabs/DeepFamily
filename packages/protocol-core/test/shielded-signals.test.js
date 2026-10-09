import test from "node:test";
import assert from "node:assert/strict";
import {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_PUBLIC_INPUTS,
  SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS,
  buildShieldedPoolPublicInputs,
  buildShieldedPoolPublicSignals,
  encodePublicShieldedBudgetEnvelope,
  getShieldedPublicBudgetFields,
  buildShieldedReceiveCodePublicSignals,
  computeShieldedCiphertextHashField,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  splitShieldedViewPublicKey,
} from "../index.js";

const ciphertextA = Uint8Array.from({ length: 512 }, () => 0x11);
const ciphertextB = Uint8Array.from({ length: 512 }, () => 0x22);
const hashA = computeShieldedCiphertextHashField(ciphertextA);
const hashB = computeShieldedCiphertextHashField(ciphertextB);
const pool = "0x0000000000000000000000000000000000000001";
const zeroPeriods = Array(12).fill(0);

const base = {
  chainId: 1030,
  poolAddress: pool,
  inputShardIds: [2, 3],
  inputRoots: [11, 12],
  inputNullifiers: [13, 14],
  periodNullifiers: zeroPeriods,
  outputCommitments: [27, 28],
  outputCiphertexts: [ciphertextA, ciphertextB],
};

test("each pool action has the verifier input count in ProofConstants.sol", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(SHIELDED_POOL_ACTION).map(([name, action]) => [
        name,
        SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS[action],
      ]),
    ),
    {
      Shield: 7,
      Fund: 27,
      Claim: 27,
      PrivateTransfer: 12,
      Unshield: 12,
    },
  );
});

test("claim signals follow the circuit's named public inputs", () => {
  const periodNullifiers = Array.from({ length: 12 }, (_, i) => i + 15);
  const { signals, witness } = buildShieldedPoolPublicInputs({
    ...base,
    action: SHIELDED_POOL_ACTION.Claim,
    inputShardIds: [2, 2],
    inputRoots: [11, 11],
    periodNullifiers,
    relation0: 29,
    relation1: 30,
    asOf: 31,
  });
  assert.deepEqual(signals, [
    1030n,
    1n,
    2n,
    2n,
    11n,
    11n,
    13n,
    14n,
    ...periodNullifiers.map(BigInt),
    27n,
    28n,
    hashA,
    hashB,
    29n,
    30n,
    31n,
  ]);
  assert.deepEqual(Object.keys(witness), [
    ...SHIELDED_POOL_PUBLIC_INPUTS[SHIELDED_POOL_ACTION.Claim],
  ]);
  assert.deepEqual(witness.inputShardIds, ["2", "2"]);
  assert.deepEqual(witness.inputNullifiers, ["13", "14"]);
  assert.deepEqual(witness.ciphertextHashes, [String(hashA), String(hashB)]);
  assert.equal(witness.asOf, "31");
});

test("two-input actions list both shard ids before both roots", () => {
  const signals = buildShieldedPoolPublicSignals({
    ...base,
    action: SHIELDED_POOL_ACTION.PrivateTransfer,
  });
  assert.deepEqual(signals, [1030n, 1n, 2n, 3n, 11n, 12n, 13n, 14n, 27n, 28n, hashA, hashB]);
});

test("fund includes its mode before the roots and keeps lineage only for the initial enrollment", () => {
  assert.deepEqual(
    buildShieldedPoolPublicSignals({
      ...base,
      action: SHIELDED_POOL_ACTION.Fund,
      fundMode: 0,
      inputShardIds: [2, 2],
      inputRoots: [11, 11],
      relation0: 29,
      relation1: 30,
      asOf: 31,
    }),
    [
      1030n,
      1n,
      0n,
      0n,
      ...Array(10).fill(0n),
      2n,
      2n,
      11n,
      11n,
      13n,
      14n,
      27n,
      28n,
      hashA,
      hashB,
      29n,
      30n,
      31n,
    ],
  );
  assert.deepEqual(
    buildShieldedPoolPublicSignals({
      ...base,
      action: SHIELDED_POOL_ACTION.Fund,
      fundMode: 1,
    }),
    [
      1030n,
      1n,
      1n,
      0n,
      ...Array(10).fill(0n),
      2n,
      3n,
      11n,
      12n,
      13n,
      14n,
      27n,
      28n,
      hashA,
      hashB,
      0n,
      0n,
      0n,
    ],
  );
  assert.throws(() =>
    buildShieldedPoolPublicSignals({ ...base, action: SHIELDED_POOL_ACTION.Fund, fundMode: 2 }),
  );
  assert.throws(() =>
    buildShieldedPoolPublicSignals({
      ...base,
      action: SHIELDED_POOL_ACTION.PrivateTransfer,
      fundMode: 1,
    }),
  );
});

test("shield and unshield bind their public amount and recipient", () => {
  const recipient = "0x00000000000000000000000000000000000000aa";
  assert.deepEqual(
    buildShieldedPoolPublicSignals({
      ...base,
      action: SHIELDED_POOL_ACTION.Shield,
      inputShardIds: [0, 0],
      inputRoots: [0, 0],
      inputNullifiers: [0, 0],
      amount: 500,
    }),
    [1030n, 1n, 27n, 28n, hashA, hashB, 500n],
  );
  assert.deepEqual(
    buildShieldedPoolPublicSignals({
      ...base,
      action: SHIELDED_POOL_ACTION.Unshield,
      inputShardIds: [2, 2],
      inputRoots: [11, 11],
      amount: 500,
      recipient,
    }),
    [1030n, 1n, 2n, 11n, 13n, 14n, 27n, 28n, hashA, hashB, 500n, 0xaan],
  );
});

test("data an action does not use must be zero, as the pool requires", () => {
  const rejects = (input, label) =>
    assert.throws(
      () => buildShieldedPoolPublicSignals(input),
      (error) => error.code === "INVALID_SHIELDED_ACTION_DATA",
      label,
    );
  rejects(
    { ...base, action: SHIELDED_POOL_ACTION.Fund, fundMode: 1, relation0: 1 },
    "continuation lineage root",
  );
  rejects({ ...base, action: SHIELDED_POOL_ACTION.PrivateTransfer, asOf: 1 }, "transfer asOf");
  rejects({ ...base, action: SHIELDED_POOL_ACTION.PrivateTransfer, amount: 1 }, "transfer amount");
  rejects(
    {
      ...base,
      action: SHIELDED_POOL_ACTION.Fund,
      periodNullifiers: [1, ...Array(11).fill(0)],
    },
    "fund period nullifier",
  );
  rejects({ ...base, action: SHIELDED_POOL_ACTION.Shield, amount: 1 }, "shield note inputs");
  rejects({ ...base, action: SHIELDED_POOL_ACTION.Unshield }, "single-input second root");
  assert.throws(
    () =>
      buildShieldedPoolPublicSignals({
        ...base,
        action: SHIELDED_POOL_ACTION.Claim,
        periodNullifiers: [0],
      }),
    (error) => error.code === "INVALID_SHIELDED_SIGNAL_SHAPE",
  );
});

test("receive code signals bind the identity, owner and exact HPKE key limbs", async () => {
  const keys = deriveShieldedHeirKeyMaterial(13n);
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const { viewKeyLo, viewKeyHi } = splitShieldedViewPublicKey(viewingKey);
  assert.deepEqual(
    buildShieldedReceiveCodePublicSignals({
      identityCommitment: 19n,
      ownerCommitment: keys.ownerCommitment,
      viewingKey,
    }),
    [19n, keys.ownerCommitment, viewKeyLo, viewKeyHi, 0n, 1n, 1n, 1n, 1n],
  );
  assert.throws(
    () =>
      buildShieldedReceiveCodePublicSignals({
        identityCommitment: 0n,
        ownerCommitment: keys.ownerCommitment,
        viewingKey,
      }),
    (error) => error.code === "ZERO_SHIELDED_SECRET",
  );
  assert.throws(
    () =>
      buildShieldedReceiveCodePublicSignals({
        identityCommitment: 19n,
        ownerCommitment: keys.ownerCommitment,
        viewingKey: new Uint8Array(32),
      }),
    (error) => error.code === "ZERO_SHIELDED_VIEW_KEY",
  );
});
