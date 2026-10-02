// Shared positive fixtures for initial and continuation Fund modes.
import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon6, poseidon8 } from "poseidon-lite";
import { buildShieldedClaimFixture } from "./generate_shielded_claim_input.mjs";

const decimal = (value) => BigInt(value).toString();
const zeroes = () => Array(32).fill("0");

export function buildShieldedFundingFixtures({
  donorAmount = 1000n,
  oldBudgetRemainingPeriods = 3n,
} = {}) {
  const heir = buildShieldedClaimFixture();
  const donorOwnerSecret = 424242n;
  const donorOwnerCommitment = poseidon2([1013n, donorOwnerSecret]);
  donorAmount = BigInt(donorAmount);
  const donorNonce = 101n;
  const donorCiphertextHash = 102n;
  const donorNote = poseidon5([
    1014n,
    donorOwnerCommitment,
    donorAmount,
    donorNonce,
    donorCiphertextHash,
  ]);
  const donorSpend = poseidon3([1016n, donorOwnerSecret, donorNote]);
  const rate = 100n;
  const rootIdentityCommitment = BigInt(heir.witness.fatherIdentityCommitment);
  const rootVersionIndex = BigInt(heir.witness.rootVersionIndex);
  const policySalt = 55555n;
  const allocationKey = 131313n;
  const allocationKeyCommitment = poseidon2([1028n, allocationKey]);
  const policy = poseidon6([
    1010n,
    rootIdentityCommitment,
    rootVersionIndex,
    rate,
    policySalt,
    allocationKeyCommitment,
  ]);
  const heirIdentityCommitment = heir.heirIdentityCommitment;
  const heirOwnerCommitment = heir.ownerCommitment;
  const eligibleFrom = BigInt(heir.witness.eligibleFrom);
  const enrollmentSalt = 66666n;
  const enrollment = poseidon5([
    1011n,
    policy,
    heirIdentityCommitment,
    eligibleFrom,
    enrollmentSalt,
  ]);
  const budgetPeriods = 4n;
  const fundedAmount = rate * budgetPeriods;
  const budgetNonce = 107n;
  const budgetCiphertextHash = 108n;
  const outputBudget = poseidon8([
    1015n,
    policy,
    enrollment,
    heirOwnerCommitment,
    rate,
    fundedAmount,
    budgetNonce,
    budgetCiphertextHash,
  ]);
  const changeNonce = 109n;
  const changeCiphertextHash = 110n;
  const outputChange = poseidon5([
    1014n,
    donorOwnerCommitment,
    donorAmount - fundedAmount,
    changeNonce,
    changeCiphertextHash,
  ]);
  const pool = BigInt("0x1111111111111111111111111111111111111111");
  oldBudgetRemainingPeriods = BigInt(oldBudgetRemainingPeriods);
  const oldBudgetRemaining = rate * oldBudgetRemainingPeriods;
  const oldBudgetNonce = 112n;
  const oldBudgetCiphertextHash = 113n;
  const oldBudget = poseidon8([
    1015n,
    policy,
    enrollment,
    heirOwnerCommitment,
    rate,
    oldBudgetRemaining,
    oldBudgetNonce,
    oldBudgetCiphertextHash,
  ]);
  const budgetUseNonce = 114n;

  const commonWitness = {
    donorOwnerSecret: decimal(donorOwnerSecret),
    donorAmount: decimal(donorAmount),
    donorNonce: decimal(donorNonce),
    donorCiphertextHash: decimal(donorCiphertextHash),
    donorDepth: "0",
    donorIndex: "0",
    donorSiblings: zeroes(),
    rootIdentityCommitment: decimal(rootIdentityCommitment),
    rootVersionIndex: decimal(rootVersionIndex),
    rate: decimal(rate),
    policySalt: decimal(policySalt),
    allocationKeyCommitment: decimal(allocationKeyCommitment),
    heirIdentityCommitment: decimal(heirIdentityCommitment),
    heirOwnerCommitment: decimal(heirOwnerCommitment),
    eligibleFrom: decimal(eligibleFrom),
    enrollmentSalt: decimal(enrollmentSalt),
    changeNonce: decimal(changeNonce),
    budgetPeriods: decimal(budgetPeriods),
    budgetNonce: decimal(budgetNonce),
  };
  const commonPublicInputs = {
    chainId: "1030",
    pool: decimal(pool),
    inputShardIds: ["0", "0"],
    outputCommitments: [outputBudget, outputChange].map(decimal),
    ciphertextHashes: [budgetCiphertextHash, changeCiphertextHash].map(decimal),
  };
  const enrollmentTag = poseidon4([1027n, allocationKey, policy, heirIdentityCommitment]);

  const lineageFields = {
    heirVersionIndex: heir.witness.versionIndex,
    fatherIdentityCommitment: heir.witness.fatherIdentityCommitment,
    motherIdentityCommitment: heir.witness.motherIdentityCommitment,
    rootIsMother: heir.witness.rootIsMother,
    endorser: heir.witness.endorser,
    writtenAt: heir.witness.writtenAt,
    endorsementDepth: heir.witness.endorsementDepth,
    endorsementIndex: heir.witness.endorsementIndex,
    endorsementSiblings: heir.witness.endorsementSiblings,
    trustedDepth: heir.witness.trustedDepth,
    trustedIndex: heir.witness.trustedIndex,
    trustedSiblings: heir.witness.trustedSiblings,
  };
  const oldFields = {
    oldBudgetRemaining: decimal(oldBudgetRemaining),
    oldBudgetRemainingPeriods: decimal(oldBudgetRemainingPeriods),
    oldBudgetNonce: decimal(oldBudgetNonce),
    oldBudgetCiphertextHash: decimal(oldBudgetCiphertextHash),
    oldBudgetDepth: "0",
    oldBudgetIndex: "0",
    oldBudgetSiblings: zeroes(),
    budgetUseNonce: decimal(budgetUseNonce),
  };
  const zeroFields = (fields) =>
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(() => "0") : "0",
      ]),
    );
  const initial = {
    ...commonPublicInputs,
    ...commonWitness,
    ...lineageFields,
    ...zeroFields(oldFields),
    fundMode: "0",
    inputRoots: [donorNote, donorNote].map(decimal),
    inputNullifiers: [donorSpend, enrollmentTag].map(decimal),
    endorsementRoot: heir.witness.endorsementRoot,
    trustedRoot: heir.witness.trustedRoot,
    asOf: decimal(eligibleFrom - 7200n),
    allocationKey: decimal(allocationKey),
  };
  const continuation = {
    ...commonPublicInputs,
    ...commonWitness,
    ...zeroFields(lineageFields),
    ...oldFields,
    fundMode: "1",
    inputRoots: [donorNote, oldBudget].map(decimal),
    inputNullifiers: [donorSpend, poseidon4([1026n, policySalt, oldBudget, budgetUseNonce])].map(
      decimal,
    ),
    endorsementRoot: "0",
    trustedRoot: "0",
    asOf: "0",
    allocationKey: "0",
  };
  return {
    initial,
    continuation,
    policy,
    enrollment,
    donorNote,
    oldBudget,
    outputBudget,
    outputChange,
  };
}
