import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon7, poseidon8 } from "poseidon-lite";
import {
  receiveCodeFixture as makeCommon,
  eligibilityFixture,
  capabilityFixture as makeCapability,
  strings,
} from "./receive_fixture.mjs";

export const poolDomain = (chainId, pool) =>
  poseidon3([1031n, BigInt(chainId), BigInt(pool)]);
export const poolTag = (purpose, chainId, pool) =>
  poseidon3([1032n, poolDomain(chainId, pool), BigInt(purpose)]);
export function policy(w) {
  return poseidon7([
    poolTag(1010, w.chainId, w.pool),
    w.familyCommitment,
    w.parentVersion,
    w.rate,
    w.policySalt,
    w.allocationKeyCommitment,
    w.periodDays,
  ]);
}
export function budgetNote(w) {
  return poseidon8([
    poolTag(75002, w.chainId, w.pool),
    w.policyCommitment,
    w.budgetKey,
    poseidon4([75003n, w.ownerCommitment, w.viewKeyLo, w.viewKeyHi]),
    w.eligibleFrom,
    w.rate,
    w.remaining,
    poseidon3([75004n, w.budgetNonce, w.budgetCiphertextHash]),
  ]);
}
export function fundFixture(
  options = {},
  common = makeCommon(),
  issuance = eligibilityFixture(),
) {
  const capability = makeCapability(issuance, common);
  const c = Object.fromEntries(
    Object.entries(common.witness).map(([key, value]) => [key, BigInt(value)]),
  );
  const w = {
    chainId: c.chainId,
    pool: 0x4444444444444444444444444444444444444444n,
    commonBinding: common.commonBinding,
    codeAlias: common.codeAlias,
    nonce: c.nonce,
    ownerCommitment: c.ownerCommitment,
    viewKeyLo: c.viewKeyLo,
    viewKeyHi: c.viewKeyHi,
    capabilityBinding: capability.publicSignals[0],
    familyTag: capability.publicSignals[1],
    parentVersion: BigInt(issuance.witness.parentVersion),
    eligibleFrom: 1800007200n,
    donorOwnerSecret: 87654n,
    donorAmount: 1000n,
    donorNonce: 76543n,
    donorCiphertextHash: 65432n,
    donorDepth: 0n,
    donorIndex: 0n,
    donorSiblings: Array(32).fill(0n),
    familyCommitment: issuance.familyRoot,
    rate: 10n,
    periodDays: 30n,
    policySalt: 54321n,
    allocationKeyCommitment: 43210n,
    budgetPeriods: 3n,
    budgetNonce: 32109n,
    changeNonce: 21098n,
    ciphertextHashes: [10987n, 9876n],
    ...options,
  };
  w.policyCommitment = policy(w);
  w.budgetKey = poseidon3([
    poolTag(75001, w.chainId, w.pool),
    w.codeAlias,
    w.policyCommitment,
  ]);
  const donorOwner = poseidon2([1013n, w.donorOwnerSecret]);
  const donorNote = poseidon5([
    poolTag(1014, w.chainId, w.pool),
    donorOwner,
    w.donorAmount,
    w.donorNonce,
    w.donorCiphertextHash,
  ]);
  w.inputRoot = donorNote;
  for (let i = 0; i < Number(w.donorDepth); i++)
    w.inputRoot =
      (w.donorIndex >> BigInt(i)) & 1n
        ? poseidon2([w.donorSiblings[i], w.inputRoot])
        : poseidon2([w.inputRoot, w.donorSiblings[i]]);
  w.inputNullifier = poseidon3([
    poolTag(1016, w.chainId, w.pool),
    w.donorOwnerSecret,
    donorNote,
  ]);
  const budgetAmount = w.rate * w.budgetPeriods;
  const outputNote = {
    chainId: w.chainId,
    pool: w.pool,
    policyCommitment: w.policyCommitment,
    budgetKey: w.budgetKey,
    ownerCommitment: w.ownerCommitment,
    viewKeyLo: w.viewKeyLo,
    viewKeyHi: w.viewKeyHi,
    eligibleFrom: w.eligibleFrom,
    rate: w.rate,
    remaining: budgetAmount,
    budgetNonce: w.budgetNonce,
    budgetCiphertextHash: w.ciphertextHashes[0],
  };
  const budgetCommitment = budgetNote(outputNote);
  const changeCommitment = poseidon5([
    poolTag(1014, w.chainId, w.pool),
    donorOwner,
    w.donorAmount - budgetAmount,
    w.changeNonce,
    w.ciphertextHashes[1],
  ]);
  w.outputCommitments = [budgetCommitment, changeCommitment];
  return {
    witness: strings(w),
    common,
    issuance,
    capability,
    outputNote,
    donorNote,
    publicSignals: [
      w.chainId,
      w.pool,
      w.commonBinding,
      w.codeAlias,
      w.nonce,
      w.ownerCommitment,
      w.viewKeyLo,
      w.viewKeyHi,
      w.capabilityBinding,
      w.familyTag,
      w.parentVersion,
      w.policyCommitment,
      w.budgetKey,
      w.eligibleFrom,
      w.inputRoot,
      w.inputNullifier,
      ...w.outputCommitments,
      ...w.ciphertextHashes,
    ],
  };
}

export function claimFixture(fund = fundFixture(), options = {}) {
  const f = Object.fromEntries(
    Object.entries(fund.witness)
      .filter(([, v]) => !Array.isArray(v))
      .map(([k, v]) => [k, BigInt(v)]),
  );
  const w = {
    chainId: f.chainId,
    pool: f.pool,
    codeAlias: f.codeAlias,
    nonce: f.nonce,
    ownerCommitment: f.ownerCommitment,
    viewKeyLo: f.viewKeyLo,
    viewKeyHi: f.viewKeyHi,
    policyCommitment: f.policyCommitment,
    budgetKey: f.budgetKey,
    eligibleFrom: f.eligibleFrom,
    asOf: f.eligibleFrom + f.periodDays * 86400n,
    derivedSecretField: BigInt(fund.common.witness.codeRootSecret),
    codeSecret: BigInt(fund.common.witness.codeSecret),
    ownerSecret: BigInt(fund.common.witness.ownerSecret),
    familyCommitment: f.familyCommitment,
    parentVersion: f.parentVersion,
    rate: f.rate,
    periodDays: f.periodDays,
    policySalt: f.policySalt,
    allocationKeyCommitment: f.allocationKeyCommitment,
    remaining: fund.outputNote.remaining,
    remainingPeriods: f.budgetPeriods,
    budgetNonce: f.budgetNonce,
    budgetCiphertextHash: fund.outputNote.budgetCiphertextHash,
    noteDepth: 0n,
    noteIndex: 0n,
    noteSiblings: Array(32).fill(0n),
    periodIndex: 0n,
    outputBudgetNonce: 8765n,
    valueNonce: 7654n,
    ciphertextHashes: [6543n, 5432n],
    authorizerScope: BigInt(fund.common.witness.authorizerScope),
    issueNonce: BigInt(fund.issuance.witness.issueNonce),
    endorser: BigInt(fund.issuance.witness.endorser),
    xChild: BigInt(fund.issuance.witness.xChild),
    xEndorse: BigInt(fund.issuance.witness.xEndorse),
    xTrust: BigInt(fund.issuance.witness.xTrust),
    credentialSalt: BigInt(fund.issuance.witness.credentialSalt),
    credentialDepth: 0n,
    credentialIndex: 0n,
    credentialSiblings: Array(32).fill(0n),
    ...options,
  };
  w.issuanceRoot = fund.issuance.credentialCommitment;
  for (let i = 0; i < Number(w.credentialDepth); i++)
    w.issuanceRoot =
      (w.credentialIndex >> BigInt(i)) & 1n
        ? poseidon2([w.credentialSiblings[i], w.issuanceRoot])
        : poseidon2([w.issuanceRoot, w.credentialSiblings[i]]);
  w.issuanceRoot = options.issuanceRoot ?? w.issuanceRoot;
  w.childTag = options.childTag ?? poseidon3([73301n, w.xChild, w.nonce]);
  w.endorsementTag = options.endorsementTag ?? poseidon3([73302n, w.xEndorse, w.nonce]);
  w.trustedTag = options.trustedTag ?? poseidon3([73303n, w.xTrust, w.nonce]);
  const oldNote = budgetNote(w);
  w.inputRoot = oldNote;
  for (let i = 0; i < Number(w.noteDepth); i++)
    w.inputRoot =
      (w.noteIndex >> BigInt(i)) & 1n
        ? poseidon2([w.noteSiblings[i], w.inputRoot])
        : poseidon2([w.inputRoot, w.noteSiblings[i]]);
  w.inputNullifier = poseidon3([poolTag(1016, w.chainId, w.pool), w.ownerSecret, oldNote]);
  w.periodNullifier = poseidon4([
    poolTag(1017, w.chainId, w.pool),
    w.derivedSecretField,
    w.policyCommitment,
    w.periodIndex,
  ]);
  const remainder = budgetNote({
    ...w,
    remaining: w.remaining - w.rate,
    budgetNonce: w.outputBudgetNonce,
    budgetCiphertextHash: w.ciphertextHashes[0],
  });
  const payout = poseidon5([
    poolTag(1014, w.chainId, w.pool),
    w.ownerCommitment,
    w.rate,
    w.valueNonce,
    w.ciphertextHashes[1],
  ]);
  w.outputCommitments = [remainder, payout];
  return {
    witness: strings(w),
    publicSignals: [
      w.chainId,
      w.pool,
      w.codeAlias,
      w.nonce,
      w.ownerCommitment,
      w.viewKeyLo,
      w.viewKeyHi,
      w.policyCommitment,
      w.budgetKey,
      w.eligibleFrom,
      w.asOf,
      w.inputRoot,
      w.inputNullifier,
      w.periodNullifier,
      ...w.outputCommitments,
      ...w.ciphertextHashes,
      w.authorizerScope,
      w.issuanceRoot,
      w.childTag,
      w.endorsementTag,
      w.trustedTag,
    ],
  };
}
