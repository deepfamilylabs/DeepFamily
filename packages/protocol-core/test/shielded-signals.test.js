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
  computeShieldedCiphertextHashField,
} from "../index.js";

const ciphertextA = Uint8Array.from({ length: 512 }, () => 0x11);
const ciphertextB = Uint8Array.from({ length: 512 }, () => 0x22);
const hashA = computeShieldedCiphertextHashField(ciphertextA);
const hashB = computeShieldedCiphertextHashField(ciphertextB);
const pool = "0x0000000000000000000000000000000000000001";
const zeroPeriods = Array(3).fill(0);

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

const valueBase = {
  ...base,
  inputShardIds: Array.from({ length: 4 }, (_, index) => index + 2),
  inputRoots: Array.from({ length: 4 }, (_, index) => index + 11),
  inputNullifiers: Array.from({ length: 4 }, (_, index) => index + 21),
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
      Fund: 29,
      Claim: 15,
      PrivateTransfer: 20,
      Unshield: 20,
    },
  );
});

test("claim signals follow the circuit's named public inputs", () => {
  const periodNullifiers = Array.from({ length: 3 }, (_, i) => i + 15);
  const { signals, witness } = buildShieldedPoolPublicInputs({
    ...base,
    action: SHIELDED_POOL_ACTION.Claim,
    inputShardIds: [2],
    inputRoots: [11],
    inputNullifiers: [13],
    periodNullifiers,
    relation0: 29,
    relation1: 30,
    asOf: 31,
    // Checkpoint lookup metadata is authenticated on chain, not added to the circuit statement.
    lineageCheckpointId: 37,
  });
  assert.deepEqual(signals, [
    1030n,
    1n,
    2n,
    11n,
    13n,
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
  assert.deepEqual(witness.inputShardIds, ["2"]);
  assert.deepEqual(witness.inputNullifiers, ["13"]);
  assert.deepEqual(witness.ciphertextHashes, [String(hashA), String(hashB)]);
  assert.equal(witness.asOf, "31");
});

test("VALUE transfers list all four shard ids before all roots and nullifiers", () => {
  const signals = buildShieldedPoolPublicSignals({
    ...valueBase,
    action: SHIELDED_POOL_ACTION.PrivateTransfer,
  });
  assert.deepEqual(signals, [
    1030n,
    1n,
    ...valueBase.inputShardIds.map(BigInt),
    ...valueBase.inputRoots.map(BigInt),
    ...valueBase.inputNullifiers.map(BigInt),
    27n,
    28n,
    hashA,
    hashB,
    0n,
    0n,
  ]);
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
      0n,
      0n,
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
      0n,
      0n,
    ],
  );
  assert.throws(() =>
    buildShieldedPoolPublicSignals({ ...base, action: SHIELDED_POOL_ACTION.Fund, fundMode: 2 }),
  );
  assert.throws(() =>
    buildShieldedPoolPublicSignals({
      ...valueBase,
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
      ...valueBase,
      action: SHIELDED_POOL_ACTION.Unshield,
      amount: 500,
      recipient,
    }),
    [
      1030n,
      1n,
      ...valueBase.inputShardIds.map(BigInt),
      ...valueBase.inputRoots.map(BigInt),
      ...valueBase.inputNullifiers.map(BigInt),
      27n,
      28n,
      hashA,
      hashB,
      500n,
      0xaan,
    ],
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
  rejects({ ...valueBase, action: SHIELDED_POOL_ACTION.PrivateTransfer, asOf: 1 }, "transfer asOf");
  rejects(
    { ...valueBase, action: SHIELDED_POOL_ACTION.PrivateTransfer, amount: 1 },
    "transfer amount",
  );
  rejects(
    {
      ...base,
      action: SHIELDED_POOL_ACTION.Fund,
      periodNullifiers: [1, ...Array(2).fill(0)],
    },
    "fund period nullifier",
  );
  rejects({ ...base, action: SHIELDED_POOL_ACTION.Shield, amount: 1 }, "shield note inputs");
  for (const action of [SHIELDED_POOL_ACTION.PrivateTransfer, SHIELDED_POOL_ACTION.Unshield]) {
    assert.throws(
      () => buildShieldedPoolPublicSignals({ ...base, action }),
      (error) => error.code === "INVALID_SHIELDED_SIGNAL_SHAPE",
      "VALUE actions reject the removed two-slot format",
    );
  }
  assert.throws(
    () =>
      buildShieldedPoolPublicSignals({
        ...base,
        action: SHIELDED_POOL_ACTION.Claim,
        inputShardIds: [2],
        inputRoots: [11],
        inputNullifiers: [13],
        periodNullifiers: [0],
      }),
    (error) => error.code === "INVALID_SHIELDED_SIGNAL_SHAPE",
  );
});

test("claims reject the removed two-budget public shape", () => {
  assert.throws(
    () => buildShieldedPoolPublicSignals({ ...base, action: SHIELDED_POOL_ACTION.Claim }),
    (error) => error.code === "INVALID_SHIELDED_SIGNAL_SHAPE",
  );
});
