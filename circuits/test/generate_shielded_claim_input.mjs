// Isolated fixture for shielded_claim_64.circom. It deliberately does not modify
// the reviewed production ZK artifact manifest or verifier assets.
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";
import {
  shieldedFixtureBudgetPurpose,
  shieldedFixtureViewingKey,
  shieldedFixtureViewLimbs,
} from "./shielded_budget_fixture.mjs";

import {
  DEFAULT_SHIELDED_FIXTURE_CHAIN_ID,
  DEFAULT_SHIELDED_FIXTURE_POOL,
  shieldedFixtureTag,
} from "./shielded_scope_fixture.mjs";

const SECONDS_PER_DAY = 86400n;
const decimal = (value) => BigInt(value).toString();

export function buildShieldedClaimFixture({
  claimCount = 2,
  periodDays = 30n,
  chainId = DEFAULT_SHIELDED_FIXTURE_CHAIN_ID,
  pool = DEFAULT_SHIELDED_FIXTURE_POOL,
  poolAddress,
  budgetKind = 0,
  keyMode = 0,
  viewingKey = shieldedFixtureViewingKey(keyMode),
  budgetOrigin = "fund",
  ownerSecret: suppliedOwnerSecret,
  remainingPeriods = 3,
} = {}) {
  if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > 3) {
    throw new RangeError("claimCount fixture must be 1..3");
  }
  chainId = BigInt(chainId);
  pool = BigInt(poolAddress ?? pool);
  const scoped = (purpose) => shieldedFixtureTag(purpose, chainId, pool);
  periodDays = BigInt(periodDays);
  const lineage = buildLineageFixture().witness;
  const derivedSecret = BigInt(lineage.derivedSecretField);
  const ownerSecret =
    suppliedOwnerSecret === undefined
      ? keyMode === 1
        ? 123456789n
        : poseidon2([1012n, derivedSecret])
      : BigInt(suppliedOwnerSecret);
  const ownerCommitment = poseidon2([1013n, ownerSecret]);
  const { viewKeyLo, viewKeyHi } = shieldedFixtureViewLimbs(viewingKey, budgetKind);
  const rootIdentityCommitment = BigInt(lineage.fatherIdentityCommitment);
  const heirIdentityCommitment = poseidon4([
    1002n,
    poseidon4([1001n, BigInt(lineage.nameField), derivedSecret, poseidon4([1000n, 1n, 0n, 0n])]),
    BigInt(lineage.birthYear) * 33554432n +
      BigInt(lineage.birthMonth) * 131072n +
      BigInt(lineage.birthDay) * 512n +
      BigInt(lineage.gender) * 2n +
      BigInt(lineage.isBirthBC),
    poseidon4([1000n, 1n, 0n, 0n]),
  ]);
  const rate = 100n;
  const remainingPeriodCount = BigInt(remainingPeriods);
  const remaining = rate * remainingPeriodCount;
  const policySalt = 55555n;
  const allocationKey = 131313n;
  const allocationKeyCommitment = poseidon2([scoped(1028n), allocationKey]);
  const enrollmentSalt = 66666n;
  const eligibleFrom = BigInt(lineage.eligibleFrom);
  const budgetNonce = 77777n;
  const budgetCiphertextHash = 88888n;
  const newBudgetNonce = 99999n;
  const payoutNonce = 123456n;
  const budgetOutputCiphertextHash = 44444n;
  const payoutOutputCiphertextHash = 33333n;
  const policy = poseidon7([
    scoped(1010n),
    rootIdentityCommitment,
    BigInt(lineage.rootVersionIndex),
    rate,
    policySalt,
    allocationKeyCommitment,
    periodDays,
  ]);
  const enrollment = poseidon5([
    scoped(1011n),
    policy,
    heirIdentityCommitment,
    eligibleFrom,
    enrollmentSalt,
  ]);
  const termsCommitment = poseidon7([
    scoped(1029n),
    rootIdentityCommitment,
    BigInt(lineage.rootVersionIndex),
    heirIdentityCommitment,
    eligibleFrom,
    rate,
    periodDays,
  ]);
  const inputBudget = poseidon8([
    scoped(shieldedFixtureBudgetPurpose(budgetKind, budgetOrigin)),
    policy,
    enrollment,
    budgetKind === 0
      ? poseidon5([scoped(1033n), ownerCommitment, BigInt(keyMode), viewKeyLo, viewKeyHi])
      : termsCommitment,
    rate,
    remaining,
    budgetNonce,
    budgetCiphertextHash,
  ]);
  const claimCountBigInt = BigInt(claimCount);
  const periodIndices = Array.from({ length: 3 }, (_, slot) =>
    slot < claimCount ? BigInt(slot) : 0n,
  );
  const asOf = eligibleFrom + claimCountBigInt * periodDays * SECONDS_PER_DAY;
  const periodNullifiers = periodIndices.map((index, slot) =>
    slot < claimCount
      ? poseidon4([scoped(1017n), derivedSecret, policy, index])
      : poseidon4([scoped(1019n), ownerSecret, inputBudget, BigInt(slot)]),
  );
  const payout = rate * claimCountBigInt;
  const requiresOpening = budgetKind === 0;
  const budgetOutput = poseidon8([
    scoped(shieldedFixtureBudgetPurpose(budgetKind, "claim")),
    policy,
    enrollment,
    requiresOpening
      ? poseidon5([scoped(1033n), ownerCommitment, BigInt(keyMode), viewKeyLo, viewKeyHi])
      : termsCommitment,
    rate,
    remaining - payout,
    newBudgetNonce,
    budgetOutputCiphertextHash,
  ]);
  const payoutOutput = poseidon5([
    scoped(1014n),
    ownerCommitment,
    payout,
    payoutNonce,
    payoutOutputCiphertextHash,
  ]);
  const publicInputs = {
    chainId: decimal(chainId),
    pool: decimal(pool),
    inputShardIds: ["0"],
    inputRoots: [decimal(inputBudget)],
    inputNullifiers: [decimal(poseidon3([scoped(1016n), ownerSecret, inputBudget]))],
    periodNullifiers: periodNullifiers.map(decimal),
    outputCommitments: [budgetOutput, payoutOutput].map(decimal),
    ciphertextHashes: [budgetOutputCiphertextHash, payoutOutputCiphertextHash].map(decimal),
    endorsementRoot: decimal(lineage.endorsementRoot),
    trustedRoot: decimal(lineage.trustedRoot),
    asOf: decimal(asOf),
  };
  const witness = {
    ...publicInputs,
    nameField: lineage.nameField,
    derivedSecretField: lineage.derivedSecretField,
    isBirthBC: lineage.isBirthBC,
    birthYear: lineage.birthYear,
    birthMonth: lineage.birthMonth,
    birthDay: lineage.birthDay,
    gender: lineage.gender,
    suiteId: lineage.suiteId,
    versionIndex: lineage.versionIndex,
    fatherIdentityCommitment: lineage.fatherIdentityCommitment,
    motherIdentityCommitment: lineage.motherIdentityCommitment,
    rootIsMother: lineage.rootIsMother,
    endorser: lineage.endorser,
    writtenAt: lineage.writtenAt,
    endorsementDepth: lineage.endorsementDepth,
    endorsementIndex: lineage.endorsementIndex,
    endorsementSiblings: lineage.endorsementSiblings,
    rootVersionIndex: lineage.rootVersionIndex,
    trustedDepth: lineage.trustedDepth,
    trustedIndex: lineage.trustedIndex,
    trustedSiblings: lineage.trustedSiblings,
    budgetKind: decimal(budgetKind),
    keyMode: decimal(keyMode),
    ownerSecret: decimal(ownerSecret),
    heirViewKeyLo: decimal(viewKeyLo),
    heirViewKeyHi: decimal(viewKeyHi),
    inputBudgetIsClaim: [
      budgetKind === 0 && budgetOrigin === "claim" ? "1" : "0",
    ],
    policyCommitmentInput: decimal(policy),
    enrollmentCommitmentInput: decimal(enrollment),
    policySalt: requiresOpening ? decimal(policySalt) : "0",
    allocationKeyCommitment: requiresOpening ? decimal(allocationKeyCommitment) : "0",
    enrollmentSalt: requiresOpening ? decimal(enrollmentSalt) : "0",
    eligibleFrom: decimal(eligibleFrom),
    rate: decimal(rate),
    periodDays: decimal(periodDays),
    remaining: decimal(remaining),
    remainingPeriods: decimal(remainingPeriodCount),
    budgetNonce: decimal(budgetNonce),
    budgetCiphertextHash: decimal(budgetCiphertextHash),
    noteDepth: "0",
    noteIndex: "0",
    noteSiblings: Array(32).fill("0"),
    claimCount: decimal(claimCountBigInt),
    periodIndices: periodIndices.map(decimal),
    newBudgetNonce: decimal(newBudgetNonce),
    payoutNonce: decimal(payoutNonce),
  };
  return {
    scope: { chainId, poolAddress: `0x${pool.toString(16).padStart(40, "0")}` },
    witness,
    policy,
    enrollment,
    inputBudget,
    heirIdentityCommitment,
    ownerSecret,
    ownerCommitment,
    viewingKey,
    budgetOrigin,
  };
}
