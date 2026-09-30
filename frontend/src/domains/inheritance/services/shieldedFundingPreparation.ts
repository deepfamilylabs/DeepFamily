import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicInputs,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedEnrollmentNullifier,
  computeShieldedOwnerCommitment,
  computeShieldedPolicyCommitment,
  computeShieldedPolicyNoteCommitment,
  computeShieldedSpendNullifier,
  computeShieldedTopUpUseNullifier,
  computeShieldedValueNoteCommitment,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedPolicyNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
  type ShieldedBudgetNotePayload,
  type ShieldedPolicyNotePayload,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish, type Contract } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import { findHeirLegitimacy, type LineageSnapshot } from "./inheritanceChain";
import type { VerifiedShieldedRecipient } from "./shieldedReceiveCode";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import { getRecoveredShieldedNoteProof, type LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const PROOF_LIFETIME = 7200n;
const ZERO_PERIODS = Array<bigint>(12).fill(0n);

type SavedTemplate<T> = {
  /** Locally saved plaintext and public envelope. Do not send plaintext to an RPC. */
  note: T;
  commitment: BigNumberish;
  ciphertext: Uint8Array;
  shardId: BigNumberish;
};

type CommonFundingInput = {
  pool: Contract;
  wallet: LocalShieldedWalletSnapshot;
  donorDerivedSecretField: BigNumberish;
  donorCommitment: BigNumberish;
  /** Verified before preparation; its keys receive the new budget. */
  recipient: VerifiedShieldedRecipient;
};

export type PreparedFundingOutput<T> = {
  note: T;
  commitment: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
};

export type PreparedShieldedFunding = {
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  policyCommitment: bigint;
  outputs: readonly [PreparedFundingOutput<ShieldedBudgetNotePayload>, PreparedFundingOutput<ShieldedValueNotePayload>];
};

export type PrepareShieldedAllocateInput = CommonFundingInput & {
  policy: SavedTemplate<ShieldedPolicyNotePayload>;
  lineageIndex: Contract;
  lineage: LineageSnapshot;
  budgetPeriods: BigNumberish;
};

export type PrepareShieldedTopUpInput = CommonFundingInput & {
  budget: SavedTemplate<ShieldedBudgetNotePayload>;
  topUpPeriods: BigNumberish;
};

function uint64(value: BigNumberish, name: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT64) throw new Error(`${name} must fit in uint64`);
  return parsed;
}

function uint128(value: BigNumberish, name: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT128) throw new Error(`${name} must fit in uint128`);
  return parsed;
}

function fundingAmount(rate: bigint, periodsInput: BigNumberish): { periods: bigint; amount: bigint } {
  const periods = uint64(periodsInput, "periods");
  if (rate === 0n || periods === 0n) throw new Error("Funding requires a positive rate and period count");
  const amount = rate * periods;
  if (amount > MAX_UINT128) throw new Error("Funding amount exceeds uint128");
  return { periods, amount };
}

function decimal(values: readonly bigint[]): string[] {
  return values.map(String);
}

function assertSnapshotBlock(snapshot: { toBlock: number; blockHash: string; invalidated?: boolean }, block: { hash?: string | null } | null, name: string) {
  if (snapshot.invalidated || !block?.hash || block.hash !== snapshot.blockHash) {
    throw new Error(`${name} snapshot is stale or reorganized`);
  }
}

async function currentContext(input: CommonFundingInput) {
  const provider = input.pool.runner?.provider;
  if (!provider) throw new Error("Shielded pool has no provider");
  const [network, poolAddress, latestBlock, walletBlock] = await Promise.all([
    provider.getNetwork(),
    input.pool.getAddress(),
    provider.getBlock("latest"),
    provider.getBlock(input.wallet.toBlock),
  ]);
  if (!latestBlock || input.wallet.toBlock > latestBlock.number) {
    throw new Error("Wallet snapshot is ahead of the chain");
  }
  const chainId = uint64(network.chainId, "chainId");
  if (
    input.wallet.chainId !== chainId ||
    input.wallet.poolAddress.toLowerCase() !== poolAddress.toLowerCase()
  ) {
    throw new Error("Funding snapshot belongs to another chain or contract");
  }
  assertSnapshotBlock(input.wallet, walletBlock, "Wallet");
  const keys = deriveShieldedHeirKeyMaterial(input.donorDerivedSecretField);
  if (input.wallet.walletOwnerCommitment !== keys.ownerCommitment) {
    throw new Error("Donor wallet belongs to another identity");
  }
  const heir = input.recipient;
  if (
    wrapIdentityCommitmentAsPersonHash(heir.identityCommitment).toLowerCase() !==
    heir.personHash.toLowerCase()
  ) {
    throw new Error("Recipient identity does not match its person hash");
  }
  return { provider, latestBlock, chainId, poolAddress: getAddress(poolAddress), keys, heir };
}

function donorInput(input: CommonFundingInput, ownerSecret: bigint) {
  const commitment = getBigInt(input.donorCommitment);
  const owned = input.wallet.ownedNotes.get(commitment);
  if (!owned || owned.note.kind !== "value") throw new Error("Donor must select a recovered value note");
  const note = owned.note;
  if (note.ownerCommitment !== computeShieldedOwnerCommitment(ownerSecret)) {
    throw new Error("Donor value note belongs to another identity");
  }
  const hash = computeShieldedCiphertextHashField(owned.ciphertext);
  if (
    hash !== owned.ciphertextHashField ||
    computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: hash }) !== commitment
  ) throw new Error("Donor note does not match its public ciphertext and commitment");
  const nullifier = computeShieldedSpendNullifier({ ownerSecret, noteCommitment: commitment });
  if (input.wallet.spentNullifiers.has(nullifier)) throw new Error("Donor value note has already been spent");
  const path = getRecoveredShieldedNoteProof(input.wallet, commitment);
  return { note, hash, nullifier, path };
}

function templatePath<T extends ShieldedPolicyNotePayload | ShieldedBudgetNotePayload>(
  wallet: LocalShieldedWalletSnapshot,
  saved: SavedTemplate<T>,
  encode: (note: T) => Uint8Array,
) {
  const commitment = getBigInt(saved.commitment);
  const shardId = getBigInt(saved.shardId);
  const payload = encode(saved.note);
  try {
    verifyShieldedNotePayload({ payload, ciphertext: saved.ciphertext, noteCommitment: commitment });
  } finally {
    payload.fill(0);
  }
  const tree = wallet.shards.get(shardId);
  if (!tree) throw new Error("Template note shard is absent from the public wallet replay");
  if (tree.sizeBigInt < 2n) throw new Error("Single-leaf note roots cannot be used privately");
  const index = tree.indexOf(commitment);
  if (BigInt(index) < 0n) throw new Error("Template note is absent from the public wallet replay");
  const proof = tree.generateProof(index);
  if (proof.leaf !== commitment || proof.siblings.length > 32) throw new Error("Template note proof is invalid");
  return {
    commitment,
    ciphertextHash: computeShieldedCiphertextHashField(saved.ciphertext),
    shardId,
    root: proof.root,
    depth: proof.siblings.length,
    index: BigInt(proof.index),
    siblings: [...proof.siblings, ...Array<bigint>(32 - proof.siblings.length).fill(0n)],
  };
}

async function encryptOutput<T extends ShieldedBudgetNotePayload | ShieldedValueNotePayload>(
  note: T,
  encode: (note: T) => Uint8Array,
  commit: (ciphertextHashField: bigint) => bigint,
  recipientPublicKey: Uint8Array,
  chainId: bigint,
  poolAddress: string,
): Promise<PreparedFundingOutput<T>> {
  const payload = encode(note);
  try {
    const ciphertext = await encryptShieldedNote({ recipientPublicKey, payload, chainId, poolAddress });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    return { note, ciphertext, ciphertextHashField, commitment: commit(ciphertextHashField) };
  } finally {
    payload.fill(0);
  }
}

async function fundingOutputs(input: {
  budget: ShieldedBudgetNotePayload;
  donorOwnerCommitment: bigint;
  donorChangeAmount: bigint;
  heirViewingKey: Uint8Array;
  donorViewIkm: string;
  chainId: bigint;
  poolAddress: string;
  policyCommitment: bigint;
  enrollmentCommitment: bigint;
}) {
  const encryptedBudget = await encryptOutput(
    input.budget,
    encodeShieldedBudgetNotePayload,
    (ciphertextHashField) => computeShieldedBudgetNoteCommitment({
      policyCommitment: input.policyCommitment,
      enrollmentCommitment: input.enrollmentCommitment,
      heirOwnerCommitment: input.budget.heirOwnerCommitment,
      amountPerPeriod: input.budget.amountPerPeriod,
      remaining: input.budget.remaining,
      nonce: input.budget.nonce,
      ciphertextHashField,
    }),
    input.heirViewingKey,
    input.chainId,
    input.poolAddress,
  );
  // The child budget is addressed only to the child. An encrypted copy of its
  // private template in the donor's change note makes future top-ups recoverable
  // from public events after the donor clears local storage.
  const change: ShieldedValueNotePayload = {
    ownerCommitment: input.donorOwnerCommitment,
    amount: input.donorChangeAmount,
    nonce: generateShieldedRandomField(),
    topUpMemo: {
      budgetCommitment: encryptedBudget.commitment,
      budgetNote: input.budget,
    },
  };
  const donorViewingKey = await deriveShieldedViewPublicKey(input.donorViewIkm);
  const encryptedChange = await encryptOutput(
    change,
    encodeShieldedValueNotePayload,
    (ciphertextHashField) => computeShieldedValueNoteCommitment({ ...change, ciphertextHashField }),
    donorViewingKey,
    input.chainId,
    input.poolAddress,
  );
  return [encryptedBudget, encryptedChange] as const;
}

function actionData(input: {
  donor: ReturnType<typeof donorInput>;
  template: ReturnType<typeof templatePath>;
  useNullifier: bigint;
  outputs: readonly [PreparedFundingOutput<ShieldedBudgetNotePayload>, PreparedFundingOutput<ShieldedValueNotePayload>];
  relation0?: bigint;
  relation1?: bigint;
  asOf?: bigint;
}): ShieldedPoolActionData {
  return {
    inputShardIds: [input.donor.path.shardId, input.template.shardId],
    inputRoots: [input.donor.path.root, input.template.root],
    inputNullifiers: [input.donor.nullifier, input.useNullifier],
    periodNullifiers: [...ZERO_PERIODS],
    outputCommitments: [input.outputs[0].commitment, input.outputs[1].commitment],
    outputCiphertexts: [input.outputs[0].ciphertext, input.outputs[1].ciphertext],
    relation0: input.relation0 ?? 0n,
    relation1: input.relation1 ?? 0n,
    asOf: input.asOf ?? 0n,
  };
}

/** The circuit's named public inputs for this action and data. */
function publicInputs(action: number, chainId: bigint, poolAddress: string, data: ShieldedPoolActionData) {
  return buildShieldedPoolPublicInputs({
    action,
    chainId,
    poolAddress,
    inputShardIds: [...data.inputShardIds],
    inputRoots: [...data.inputRoots],
    inputNullifiers: [...data.inputNullifiers],
    periodNullifiers: [...data.periodNullifiers],
    outputCommitments: [...data.outputCommitments],
    outputCiphertexts: [...data.outputCiphertexts],
    amount: 0n,
    relation0: data.relation0,
    relation1: data.relation1,
    asOf: data.asOf,
  }).witness;
}

/** Build a new, independent child budget from a donor value note and a saved policy template. */
export async function prepareShieldedAllocate(input: PrepareShieldedAllocateInput): Promise<PreparedShieldedFunding> {
  const ctx = await currentContext(input);
  const expectedIndex = getAddress(await input.pool.LINEAGE_INDEX());
  if (expectedIndex.toLowerCase() !== (await input.lineageIndex.getAddress()).toLowerCase()) {
    throw new Error("Lineage index does not belong to this shielded pool");
  }
  const donor = donorInput(input, ctx.keys.ownerSecret);
  const template = templatePath(input.wallet, input.policy, encodeShieldedPolicyNotePayload);
  const policy = input.policy.note;
  const allocationKeyCommitment = computeShieldedAllocationKeyCommitment(policy.allocationKey);
  const policyCommitment = computeShieldedPolicyCommitment({ ...policy, allocationKeyCommitment });
  if (computeShieldedPolicyNoteCommitment({
    policyCommitment, nonce: policy.nonce, ciphertextHashField: template.ciphertextHash,
  }) !== template.commitment) throw new Error("Policy template commitment mismatch");
  const { periods, amount } = fundingAmount(uint128(policy.amountPerPeriod, "rate"), input.budgetPeriods);
  if (donor.note.amount < amount) throw new Error("Donor value note cannot fund the whole child budget");
  const heir = ctx.heir;
  const enrollmentNullifier = computeShieldedEnrollmentNullifier({
    allocationKey: policy.allocationKey,
    policyCommitment,
    heirIdentityCommitment: heir.identityCommitment,
  });
  if (input.wallet.spentNullifiers.has(enrollmentNullifier)) throw new Error("This child is already allocated under this policy");
  const latestBlock = ctx.latestBlock;
  if (input.lineage.blockNumber > latestBlock.number) throw new Error("Lineage snapshot is ahead of the chain");
  const [endorsementRoot, trustedRoot] = await Promise.all([
    input.lineageIndex.root(0, { blockTag: latestBlock.number }),
    input.lineageIndex.root(1, { blockTag: latestBlock.number }),
  ]);
  if (
    input.lineage.endorsementTree.root !== BigInt(endorsementRoot) ||
    input.lineage.trustedTree.root !== BigInt(trustedRoot)
  ) throw new Error("Lineage snapshot roots are stale; replay public events");
  const asOf = uint64(latestBlock.timestamp, "asOf");
  const eligibleFrom = uint64(asOf + PROOF_LIFETIME, "eligibleFrom");
  const rootPersonHash = wrapIdentityCommitmentAsPersonHash(policy.rootIdentityCommitment);
  const rootVersion = input.lineage.versions.get(rootPersonHash.toLowerCase())?.find(
    (version) => BigInt(version.versionIndex) === getBigInt(policy.rootVersionIndex),
  );
  if (!rootVersion || rootVersion.identityCommitment !== getBigInt(policy.rootIdentityCommitment)) {
    throw new Error("Policy root version is absent from the lineage snapshot");
  }
  const legitimacy = findHeirLegitimacy({
    snapshot: input.lineage,
    heir: { personHash: heir.personHash, identityCommitment: heir.identityCommitment },
    root: { identityCommitment: getBigInt(policy.rootIdentityCommitment) },
    rootVersionIndex: Number(policy.rootVersionIndex),
  }).find((candidate) => candidate.writtenAt <= asOf);
  if (!legitimacy) throw new Error("Heir has no current direct-child endorsement from a trusted source");
  const endorsementProof = input.lineage.endorsementTree.generateProof(legitimacy.endorsementLeafIndex);
  const trustedProof = input.lineage.trustedTree.generateProof(legitimacy.trustedLeafIndex);
  const endorsementLeaf = computeLineageEndorsementLeaf({
    identityCommitment: heir.identityCommitment,
    parentsDigest: computeLineageParentsDigest({
      fatherIdentityCommitment: legitimacy.fatherIdentityCommitment,
      motherIdentityCommitment: legitimacy.motherIdentityCommitment,
    }),
    versionIndex: legitimacy.versionIndex,
    endorser: legitimacy.endorser,
    writtenAt: legitimacy.writtenAt,
  });
  const trustedLeaf = computeLineageTrustedLeaf({
    rootIdentityCommitment: policy.rootIdentityCommitment,
    rootVersionIndex: policy.rootVersionIndex,
    account: legitimacy.endorser,
  });
  if (
    endorsementProof.leaf !== endorsementLeaf || trustedProof.leaf !== trustedLeaf ||
    endorsementProof.siblings.length > 64 || trustedProof.siblings.length > 64
  ) throw new Error("Lineage proof does not match active endorsement and trust leaves");
  const enrollmentSalt = generateShieldedRandomField();
  const enrollmentCommitment = computeShieldedEnrollmentCommitment({
    policyCommitment, heirIdentityCommitment: heir.identityCommitment, eligibleFrom, enrollmentSalt,
  });
  const budget: ShieldedBudgetNotePayload = {
    rootIdentityCommitment: policy.rootIdentityCommitment,
    rootVersionIndex: policy.rootVersionIndex,
    policySalt: policy.policySalt,
    allocationKeyCommitment,
    heirIdentityCommitment: heir.identityCommitment,
    eligibleFrom,
    enrollmentSalt,
    heirOwnerCommitment: heir.ownerCommitment,
    amountPerPeriod: policy.amountPerPeriod,
    remaining: amount,
    nonce: generateShieldedRandomField(),
  };
  const outputs = await fundingOutputs({
    budget,
    donorOwnerCommitment: ctx.keys.ownerCommitment,
    donorChangeAmount: donor.note.amount - amount,
    heirViewingKey: getBytes(heir.viewingKey),
    donorViewIkm: ctx.keys.hpkeIkm,
    chainId: ctx.chainId,
    poolAddress: ctx.poolAddress,
    policyCommitment,
    enrollmentCommitment,
  });
  const data = actionData({ donor, template, useNullifier: enrollmentNullifier, outputs,
    relation0: BigInt(endorsementRoot), relation1: BigInt(trustedRoot), asOf });
  const witness: ShieldedWitness = {
    ...publicInputs(SHIELDED_POOL_ACTION.Allocate, ctx.chainId, ctx.poolAddress, data),
    donorOwnerSecret: String(ctx.keys.ownerSecret),
    donorAmount: String(donor.note.amount),
    donorNonce: String(donor.note.nonce),
    donorCiphertextHash: String(donor.hash),
    donorDepth: donor.path.proofDepth,
    donorIndex: String(donor.path.proofIndex),
    donorSiblings: decimal(donor.path.siblings),
    rootIdentityCommitment: String(policy.rootIdentityCommitment),
    rootVersionIndex: String(policy.rootVersionIndex),
    rate: String(policy.amountPerPeriod),
    policySalt: String(policy.policySalt),
    allocationKey: String(policy.allocationKey),
    policyNonce: String(policy.nonce),
    policyCiphertextHash: String(template.ciphertextHash),
    policyDepth: template.depth,
    policyIndex: String(template.index),
    policySiblings: decimal(template.siblings),
    heirIdentityCommitment: String(heir.identityCommitment),
    heirOwnerCommitment: String(heir.ownerCommitment),
    heirVersionIndex: String(legitimacy.versionIndex),
    fatherIdentityCommitment: String(legitimacy.fatherIdentityCommitment),
    motherIdentityCommitment: String(legitimacy.motherIdentityCommitment),
    rootIsMother: legitimacy.rootIsMother ? "1" : "0",
    endorser: String(BigInt(legitimacy.endorser)),
    writtenAt: String(legitimacy.writtenAt),
    endorsementDepth: endorsementProof.siblings.length,
    endorsementIndex: String(endorsementProof.index),
    endorsementSiblings: decimal([...endorsementProof.siblings, ...Array<bigint>(64 - endorsementProof.siblings.length).fill(0n)]),
    trustedDepth: trustedProof.siblings.length,
    trustedIndex: String(trustedProof.index),
    trustedSiblings: decimal([...trustedProof.siblings, ...Array<bigint>(64 - trustedProof.siblings.length).fill(0n)]),
    eligibleFrom: String(eligibleFrom),
    enrollmentSalt: String(enrollmentSalt),
    budgetPeriods: String(periods),
    budgetNonce: String(budget.nonce),
    changeNonce: String(outputs[1].note.nonce),
  };
  return { data, witness, policyCommitment, outputs };
}

/** Add a new whole-period budget using a saved child budget as read-only template. */
export async function prepareShieldedTopUp(input: PrepareShieldedTopUpInput): Promise<PreparedShieldedFunding> {
  const ctx = await currentContext(input);
  const donor = donorInput(input, ctx.keys.ownerSecret);
  const template = templatePath(input.wallet, input.budget, encodeShieldedBudgetNotePayload);
  const old = input.budget.note;
  const heir = ctx.heir;
  if (
    getBigInt(old.heirIdentityCommitment) !== heir.identityCommitment ||
    getBigInt(old.heirOwnerCommitment) !== heir.ownerCommitment
  ) throw new Error("Budget template does not belong to this receive code's recipient");
  const rate = uint128(old.amountPerPeriod, "rate");
  const oldRemaining = uint128(old.remaining, "old remaining budget");
  if (rate === 0n || oldRemaining % rate !== 0n) throw new Error("Template budget has fractional periods");
  const { periods, amount } = fundingAmount(rate, input.topUpPeriods);
  if (donor.note.amount < amount) throw new Error("Donor value note cannot fund the whole top-up");
  const policyCommitment = computeShieldedPolicyCommitment(old);
  const enrollmentCommitment = computeShieldedEnrollmentCommitment({
    policyCommitment, heirIdentityCommitment: old.heirIdentityCommitment,
    eligibleFrom: old.eligibleFrom, enrollmentSalt: old.enrollmentSalt,
  });
  const budgetUseNonce = generateShieldedRandomField();
  const useNullifier = computeShieldedTopUpUseNullifier({
    policySalt: old.policySalt, budgetNoteCommitment: template.commitment, useNonce: budgetUseNonce,
  });
  if (input.wallet.spentNullifiers.has(useNullifier)) throw new Error("Top-up authorization was already used");
  const budget: ShieldedBudgetNotePayload = {
    ...old,
    remaining: amount,
    nonce: generateShieldedRandomField(),
  };
  const outputs = await fundingOutputs({
    budget,
    donorOwnerCommitment: ctx.keys.ownerCommitment,
    donorChangeAmount: donor.note.amount - amount,
    heirViewingKey: getBytes(heir.viewingKey),
    donorViewIkm: ctx.keys.hpkeIkm,
    chainId: ctx.chainId,
    poolAddress: ctx.poolAddress,
    policyCommitment,
    enrollmentCommitment,
  });
  const data = actionData({ donor, template, useNullifier, outputs });
  const witness: ShieldedWitness = {
    ...publicInputs(SHIELDED_POOL_ACTION.TopUp, ctx.chainId, ctx.poolAddress, data),
    donorOwnerSecret: String(ctx.keys.ownerSecret),
    donorAmount: String(donor.note.amount),
    donorNonce: String(donor.note.nonce),
    donorCiphertextHash: String(donor.hash),
    donorDepth: donor.path.proofDepth,
    donorIndex: String(donor.path.proofIndex),
    donorSiblings: decimal(donor.path.siblings),
    rootIdentityCommitment: String(old.rootIdentityCommitment),
    rootVersionIndex: String(old.rootVersionIndex),
    rate: String(rate),
    policySalt: String(old.policySalt),
    allocationKeyCommitment: String(old.allocationKeyCommitment),
    heirIdentityCommitment: String(heir.identityCommitment),
    heirOwnerCommitment: String(heir.ownerCommitment),
    eligibleFrom: String(old.eligibleFrom),
    enrollmentSalt: String(old.enrollmentSalt),
    oldBudgetRemaining: String(oldRemaining),
    oldBudgetRemainingPeriods: String(oldRemaining / rate),
    oldBudgetNonce: String(old.nonce),
    oldBudgetCiphertextHash: String(template.ciphertextHash),
    oldBudgetDepth: template.depth,
    oldBudgetIndex: String(template.index),
    oldBudgetSiblings: decimal(template.siblings),
    budgetUseNonce: String(budgetUseNonce),
    topUpPeriods: String(periods),
    newBudgetNonce: String(budget.nonce),
    changeNonce: String(outputs[1].note.nonce),
  };
  return { data, witness, policyCommitment, outputs };
}
