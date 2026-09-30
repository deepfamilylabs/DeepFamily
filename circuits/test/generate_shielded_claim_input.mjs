// Isolated fixture for shielded_claim.circom. It deliberately does not modify
// the reviewed production ZK artifact manifest or verifier assets.
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon6, poseidon8 } from "poseidon-lite";
import { buildLineageFixture } from "./generate_lineage_fixture.mjs";

const PERIOD = 2_592_000n;
const decimal = (value) => BigInt(value).toString();

export function buildShieldedClaimFixture({ claimCount = 2, remainingPeriods = 3 } = {}) {
  if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > 12) {
    throw new RangeError("claimCount fixture must be 1..12");
  }
  const lineage = buildLineageFixture().witness;
  const derivedSecret = BigInt(lineage.derivedSecretField);
  const ownerSecret = poseidon2([1012n, derivedSecret]);
  const ownerCommitment = poseidon2([1013n, ownerSecret]);
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
  const allocationKeyCommitment = poseidon2([1028n, allocationKey]);
  const enrollmentSalt = 66666n;
  const eligibleFrom = BigInt(lineage.eligibleFrom);
  const budgetNonce = 77777n;
  const budgetCiphertextHash = 88888n;
  const newBudgetNonce = 99999n;
  const payoutNonce = 123456n;
  const budgetOutputCiphertextHash = 44444n;
  const payoutOutputCiphertextHash = 33333n;
  const policy = poseidon6([
    1010n,
    rootIdentityCommitment,
    BigInt(lineage.rootVersionIndex),
    rate,
    policySalt,
    allocationKeyCommitment,
  ]);
  const enrollment = poseidon5([
    1011n,
    policy,
    heirIdentityCommitment,
    eligibleFrom,
    enrollmentSalt,
  ]);
  const inputBudget = poseidon8([
    1015n,
    policy,
    enrollment,
    ownerCommitment,
    rate,
    remaining,
    budgetNonce,
    budgetCiphertextHash,
  ]);
  const claimCountBigInt = BigInt(claimCount);
  const periodIndices = Array.from({ length: 12 }, (_, slot) =>
    slot < claimCount ? BigInt(slot) : 0n,
  );
  const asOf = eligibleFrom + claimCountBigInt * PERIOD;
  const periodNullifiers = periodIndices.map((index, slot) =>
    slot < claimCount
      ? poseidon4([1017n, derivedSecret, policy, index])
      : poseidon4([1019n, ownerSecret, inputBudget, BigInt(slot)]),
  );
  const payout = rate * claimCountBigInt;
  const budgetOutput = poseidon8([
    1015n,
    policy,
    enrollment,
    ownerCommitment,
    rate,
    remaining - payout,
    newBudgetNonce,
    budgetOutputCiphertextHash,
  ]);
  const payoutOutput = poseidon5([
    1014n,
    ownerCommitment,
    payout,
    payoutNonce,
    payoutOutputCiphertextHash,
  ]);
  const publicInputs = {
    chainId: "1030",
    pool: decimal(BigInt("0x1111111111111111111111111111111111111111")),
    inputShardId: "0",
    inputRoot: decimal(inputBudget),
    inputNullifiers: [
      poseidon3([1016n, ownerSecret, inputBudget]),
      poseidon3([1021n, ownerSecret, inputBudget]),
    ].map(decimal),
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
    policySalt: decimal(policySalt),
    allocationKeyCommitment: decimal(allocationKeyCommitment),
    enrollmentSalt: decimal(enrollmentSalt),
    eligibleFrom: decimal(eligibleFrom),
    rate: decimal(rate),
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
    witness,
    policy,
    enrollment,
    inputBudget,
    heirIdentityCommitment,
    ownerSecret,
    ownerCommitment,
  };
}
