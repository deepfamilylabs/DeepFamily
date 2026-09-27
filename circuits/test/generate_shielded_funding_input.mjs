// Shared positive fixtures for the isolated Allocate and TopUp circuits.
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
  const policyNonce = 103n;
  const policyCiphertextHash = 104n;
  const policyNote = poseidon4([1024n, policy, policyNonce, policyCiphertextHash]);
  const heirIdentityCommitment = heir.heirIdentityCommitment;
  const heirOwnerCommitment = heir.ownerCommitment;
  const viewKeyHi = 105n;
  const viewKeyLo = 106n;
  const registryLeaf = poseidon5([
    1023n,
    heirIdentityCommitment,
    heirOwnerCommitment,
    viewKeyHi,
    viewKeyLo,
  ]);
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
    heirIdentityCommitment: decimal(heirIdentityCommitment),
    heirOwnerCommitment: decimal(heirOwnerCommitment),
    viewKeyHi: decimal(viewKeyHi),
    viewKeyLo: decimal(viewKeyLo),
    registrationDepth: "0",
    registrationIndex: "0",
    registrationSiblings: zeroes(),
    eligibleFrom: decimal(eligibleFrom),
    enrollmentSalt: decimal(enrollmentSalt),
    changeNonce: decimal(changeNonce),
  };
  const commonSignals = [
    0n,
    1030n,
    pool,
    0n,
    donorNote,
    0n,
    0n,
    donorSpend,
    0n,
    ...Array(12).fill(0n),
    outputBudget,
    outputChange,
    budgetCiphertextHash,
    changeCiphertextHash,
    0n,
    0n,
    0n,
    0n,
    0n,
    registryLeaf,
    0n,
  ];

  const allocateSignals = [...commonSignals];
  allocateSignals[0] = 2n;
  allocateSignals[6] = policyNote;
  allocateSignals[8] = poseidon4([1027n, allocationKey, policy, heirIdentityCommitment]);
  allocateSignals[27] = BigInt(heir.witness.publicSignals[27]);
  allocateSignals[28] = BigInt(heir.witness.publicSignals[28]);
  allocateSignals[29] = eligibleFrom - 7200n;
  const allocate = {
    ...commonWitness,
    publicSignals: allocateSignals.map(decimal),
    policyNonce: decimal(policyNonce),
    policyCiphertextHash: decimal(policyCiphertextHash),
    policyDepth: "0",
    policyIndex: "0",
    policySiblings: zeroes(),
    allocationKey: decimal(allocationKey),
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
    budgetPeriods: decimal(budgetPeriods),
    budgetNonce: decimal(budgetNonce),
  };

  const topUpSignals = [...commonSignals];
  topUpSignals[0] = 3n;
  topUpSignals[6] = oldBudget;
  topUpSignals[8] = poseidon4([1026n, policySalt, oldBudget, budgetUseNonce]);
  const topUp = {
    ...commonWitness,
    allocationKeyCommitment: decimal(allocationKeyCommitment),
    publicSignals: topUpSignals.map(decimal),
    oldBudgetRemaining: decimal(oldBudgetRemaining),
    oldBudgetRemainingPeriods: decimal(oldBudgetRemainingPeriods),
    oldBudgetNonce: decimal(oldBudgetNonce),
    oldBudgetCiphertextHash: decimal(oldBudgetCiphertextHash),
    oldBudgetDepth: "0",
    oldBudgetIndex: "0",
    oldBudgetSiblings: zeroes(),
    budgetUseNonce: decimal(budgetUseNonce),
    topUpPeriods: decimal(budgetPeriods),
    newBudgetNonce: decimal(budgetNonce),
  };
  return {
    allocate,
    topUp,
    policy,
    enrollment,
    donorNote,
    policyNote,
    oldBudget,
    registryLeaf,
    outputBudget,
    outputChange,
  };
}
