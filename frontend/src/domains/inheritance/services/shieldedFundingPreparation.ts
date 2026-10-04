import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicInputs,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedAllocationKeyCommitment,
  computeShieldedNoteCommitmentFromPayload,
  getShieldedBudgetCommitments,
  encodePublicShieldedBudgetEnvelope,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedEnrollmentNullifier,
  computeShieldedOwnerCommitment,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedBudgetUseNullifier,
  computeShieldedValueNoteCommitment,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
  type ShieldedBudgetNotePayload,
  type ShieldedBudgetRuleOpening,
  type ShieldedIdentityBudgetNotePayload,
  type ShieldedPolicyDescriptor,
  type ShieldedScope,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish, type Contract } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import { findHeirLegitimacy, type LineageSnapshot } from "./inheritanceChain";
import type { VerifiedShieldedRecipient } from "./shieldedReceiveCode";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";
import { getLocalShieldedNoteProof } from "./shieldedPoolChain";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const PROOF_LIFETIME = 7200n;
const ZERO_PERIODS = Array<bigint>(12).fill(0n);

export type SavedTemplate<T> = {
  /** Locally saved plaintext and public envelope. Do not send plaintext to an RPC. */
  note: T;
  commitment: BigNumberish;
  ciphertext: Uint8Array;
  shardId: BigNumberish;
  ruleOpening?: ShieldedBudgetRuleOpening;
};

type CommonFundingInput = {
  pool: Contract;
  wallet: LocalShieldedWalletSnapshot;
  donorDerivedSecretField: BigNumberish;
  donorCommitment: BigNumberish;
  /** Verified before preparation; its keys receive the new budget. */
  recipient?: VerifiedShieldedRecipient;
  budgetKind?: 0 | 1;
  publicRecipientPersonHash?: string;
  lineageIndex?: Contract;
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
  outputs: readonly [
    PreparedFundingOutput<ShieldedBudgetNotePayload>,
    PreparedFundingOutput<ShieldedValueNotePayload>,
  ];
};

export type PrepareShieldedFundInput = CommonFundingInput &
  (
    | {
        fundMode: 0;
        policy: ShieldedPolicyDescriptor;
        lineageIndex: Contract;
        lineage: LineageSnapshot;
        budgetPeriods: BigNumberish;
      }
    | {
        fundMode: 1;
        budget: SavedTemplate<ShieldedBudgetNotePayload>;
        budgetPeriods: BigNumberish;
      }
  );

type InitialFundingInput = Extract<PrepareShieldedFundInput, { fundMode: 0 }>;
type ContinuationFundingInput = Extract<PrepareShieldedFundInput, { fundMode: 1 }>;

export function shieldedPolicyCommitment(
  policy: ShieldedPolicyDescriptor,
  scope: ShieldedScope,
): bigint {
  return computeShieldedPolicyCommitment(
    {
      ...policy,
      allocationKeyCommitment: computeShieldedAllocationKeyCommitment(policy.allocationKey, scope),
    },
    scope,
  );
}

/** A draft is local until its first funding transaction backs it up in encrypted change. */
export function createShieldedPolicyDescriptor(
  input: {
    rootIdentityCommitment: BigNumberish;
    rootVersionIndex: BigNumberish;
    amountPerPeriod: BigNumberish;
    periodDays: BigNumberish;
  },
  scope: ShieldedScope,
): ShieldedPolicyDescriptor {
  const policy = {
    rootIdentityCommitment: getBigInt(input.rootIdentityCommitment),
    rootVersionIndex: uint64(input.rootVersionIndex, "rootVersionIndex"),
    amountPerPeriod: uint128(input.amountPerPeriod, "amountPerPeriod"),
    periodDays: positiveUint32(input.periodDays, "periodDays"),
    policySalt: generateShieldedRandomField(),
    allocationKey: generateShieldedRandomField(),
  };
  shieldedPolicyCommitment(policy, scope);
  return policy;
}

const ZERO_TEMPLATE_WITNESS: ShieldedWitness = {
  oldBudgetKind: "0",
  oldHeirOwnerCommitment: "0",
  oldBudgetRemaining: "0",
  oldBudgetRemainingPeriods: "0",
  oldBudgetNonce: "0",
  oldBudgetCiphertextHash: "0",
  oldBudgetDepth: 0,
  oldBudgetIndex: "0",
  oldBudgetSiblings: Array<string>(32).fill("0"),
  budgetUseNonce: "0",
};
const ZERO_LINEAGE_WITNESS: ShieldedWitness = {
  allocationKey: "0",
  heirVersionIndex: "0",
  fatherIdentityCommitment: "0",
  motherIdentityCommitment: "0",
  rootIsMother: "0",
  endorser: "0",
  writtenAt: "0",
  endorsementDepth: 0,
  endorsementIndex: "0",
  endorsementSiblings: Array<string>(64).fill("0"),
  trustedDepth: 0,
  trustedIndex: "0",
  trustedSiblings: Array<string>(64).fill("0"),
};

export function prepareShieldedFund(
  input: PrepareShieldedFundInput,
): Promise<PreparedShieldedFunding> {
  if (input.budgetKind !== undefined && input.budgetKind !== 0 && input.budgetKind !== 1)
    throw new Error("Budget visibility must be private or public");
  if (input.fundMode === 0) return prepareInitialFunding(input);
  if (input.fundMode === 1) return prepareContinuationFunding(input);
  throw new Error("Fund mode must be initial or continuation");
}

function uint64(value: BigNumberish, name: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT64) throw new Error(`${name} must fit in uint64`);
  return parsed;
}

function positiveUint32(value: BigNumberish, name: string): bigint {
  const parsed = getBigInt(value);
  if (parsed <= 0n || parsed > MAX_UINT32) throw new Error(`${name} must be a positive uint32`);
  return parsed;
}

function uint128(value: BigNumberish, name: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT128) throw new Error(`${name} must fit in uint128`);
  return parsed;
}

function fundingAmount(
  rate: bigint,
  periodsInput: BigNumberish,
): { periods: bigint; amount: bigint } {
  const periods = uint64(periodsInput, "periods");
  if (rate === 0n || periods === 0n)
    throw new Error("Funding requires a positive rate and period count");
  const amount = rate * periods;
  if (amount > MAX_UINT128) throw new Error("Funding amount exceeds uint128");
  return { periods, amount };
}

function decimal(values: readonly bigint[]): string[] {
  return values.map(String);
}

function assertSnapshotBlock(
  snapshot: { toBlock: number; blockHash: string; invalidated?: boolean },
  block: { hash?: string | null } | null,
  name: string,
) {
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
  let heir: {
    personHash: string;
    identityCommitment: bigint;
    ownerCommitment: bigint;
    viewingKey?: string;
  };
  if (input.budgetKind === 1) {
    if (!input.lineageIndex || !input.publicRecipientPersonHash)
      throw new Error("Public funding requires a selected family identity");
    if (
      getAddress(await input.pool.LINEAGE_INDEX()) !==
      getAddress(await input.lineageIndex.getAddress())
    )
      throw new Error("Lineage index does not belong to this shielded pool");
    const identityCommitment = getBigInt(
      await input.lineageIndex.identityCommitmentOf(input.publicRecipientPersonHash),
    );
    if (identityCommitment === 0n) throw new Error("Recipient identity is unknown");
    heir = { personHash: input.publicRecipientPersonHash, identityCommitment, ownerCommitment: 0n };
  } else {
    if (!input.recipient || input.recipient.ownerCommitment === 0n)
      throw new Error("Private funding requires a verified receive code");
    heir = input.recipient;
  }
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
  if (!owned || owned.note.kind !== "value")
    throw new Error("Donor must select a recovered value note");
  const note = owned.note;
  if (note.ownerCommitment !== computeShieldedOwnerCommitment(ownerSecret)) {
    throw new Error("Donor value note belongs to another identity");
  }
  const hash = computeShieldedCiphertextHashField(owned.ciphertext);
  if (
    hash !== owned.ciphertextHashField ||
    computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: hash }, input.wallet) !==
      commitment
  )
    throw new Error("Donor note does not match its public ciphertext and commitment");
  const nullifier = computeShieldedSpendNullifier(
    { ownerSecret, noteCommitment: commitment },
    input.wallet,
  );
  if (input.wallet.spentNullifiers.has(nullifier))
    throw new Error("Donor value note has already been spent");
  const path = getLocalShieldedNoteProof(input.wallet, commitment);
  return { note, hash, nullifier, path };
}

function templatePath<T extends ShieldedBudgetNotePayload>(
  wallet: LocalShieldedWalletSnapshot,
  saved: SavedTemplate<T>,
  encode: (note: T, scope: ShieldedScope) => Uint8Array,
) {
  const commitment = getBigInt(saved.commitment);
  const shardId = getBigInt(saved.shardId);
  const payload = encode(saved.note, wallet);
  try {
    verifyShieldedNotePayload(
      {
        payload,
        ciphertext: saved.ciphertext,
        noteCommitment: commitment,
      },
      wallet,
    );
  } finally {
    payload.fill(0);
  }
  const tree = wallet.shards.get(shardId);
  if (!tree) throw new Error("Template note shard is absent from the public wallet replay");
  if (tree.sizeBigInt < 2n) throw new Error("Single-leaf note roots cannot be used privately");
  const index = tree.indexOf(commitment);
  if (BigInt(index) < 0n) throw new Error("Template note is absent from the public wallet replay");
  const proof = tree.generateProof(index);
  if (proof.leaf !== commitment || proof.siblings.length > 32)
    throw new Error("Template note proof is invalid");
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
  encode: (note: T, scope: ShieldedScope) => Uint8Array,
  commit: (ciphertextHashField: bigint) => bigint,
  recipientPublicKey: Uint8Array,
  chainId: bigint,
  poolAddress: string,
): Promise<PreparedFundingOutput<T>> {
  const payload = encode(note, { chainId, poolAddress });
  try {
    const ciphertext = await encryptShieldedNote({
      recipientPublicKey,
      payload,
      chainId,
      poolAddress,
    });
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
  heirViewingKey?: Uint8Array;
  publicDelivery: boolean;
  ruleOpening?: ShieldedBudgetRuleOpening;
  donorViewIkm: string;
  chainId: bigint;
  poolAddress: string;
  policyCommitment: bigint;
  enrollmentCommitment: bigint;
  allocationKey?: bigint;
}) {
  const payload = encodeShieldedBudgetNotePayload(input.budget, input);
  let encryptedBudget: PreparedFundingOutput<ShieldedBudgetNotePayload>;
  try {
    const ciphertext = input.publicDelivery
      ? encodePublicShieldedBudgetEnvelope(input.budget as ShieldedIdentityBudgetNotePayload, input)
      : await encryptShieldedNote({
          recipientPublicKey: input.heirViewingKey!,
          payload,
          chainId: input.chainId,
          poolAddress: input.poolAddress,
        });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    const { noteCommitment: commitment } = computeShieldedNoteCommitmentFromPayload(
      {
        payload,
        ciphertextHashField,
      },
      input,
    );
    encryptedBudget = { note: input.budget, ciphertext, ciphertextHashField, commitment };
  } finally {
    payload.fill(0);
  }
  // The donor's encrypted change backs up the budget and its private rule opening.
  // Public delivery never includes that opening; reloading the donor wallet can
  // still restore both the funding template and the original local policy.
  const change: ShieldedValueNotePayload = {
    ownerCommitment: input.donorOwnerCommitment,
    amount: input.donorChangeAmount,
    nonce: generateShieldedRandomField(),
    fundingMemo: {
      budgetCommitment: encryptedBudget.commitment,
      budgetNote: input.budget,
      ...(input.ruleOpening ? { ruleOpening: input.ruleOpening } : {}),
      ...(input.allocationKey === undefined ? {} : { allocationKey: input.allocationKey }),
    },
  };
  const donorViewingKey = await deriveShieldedViewPublicKey(input.donorViewIkm);
  const encryptedChange = await encryptOutput(
    change,
    encodeShieldedValueNotePayload,
    (ciphertextHashField) =>
      computeShieldedValueNoteCommitment({ ...change, ciphertextHashField }, input),
    donorViewingKey,
    input.chainId,
    input.poolAddress,
  );
  return [encryptedBudget, encryptedChange] as const;
}

function actionData(input: {
  fundMode: 0 | 1;
  budgetKind: 0 | 1;
  donor: ReturnType<typeof donorInput>;
  template?: ReturnType<typeof templatePath>;
  useNullifier: bigint;
  outputs: readonly [
    PreparedFundingOutput<ShieldedBudgetNotePayload>,
    PreparedFundingOutput<ShieldedValueNotePayload>,
  ];
  relation0?: bigint;
  relation1?: bigint;
  asOf?: bigint;
}): ShieldedPoolActionData {
  return {
    fundMode: BigInt(input.fundMode),
    budgetKind: BigInt(input.budgetKind),
    inputShardIds: [input.donor.path.shardId, input.template?.shardId ?? input.donor.path.shardId],
    inputRoots: [input.donor.path.root, input.template?.root ?? input.donor.path.root],
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
function publicInputs(
  action: number,
  chainId: bigint,
  poolAddress: string,
  data: ShieldedPoolActionData,
) {
  return buildShieldedPoolPublicInputs({
    action,
    fundMode: data.fundMode,
    budgetKind: data.budgetKind,
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

/** Client funding rules use the identity recovered alongside the parent's VALUE. */
function assertFundingParent(wallet: LocalShieldedWalletSnapshot, rootIdentity: BigNumberish) {
  if (wallet.walletIdentityCommitment === undefined) {
    throw new Error("Funding requires a wallet recovered with the parent's identity");
  }
  if (getBigInt(rootIdentity) !== wallet.walletIdentityCommitment) {
    throw new Error("Funding rule belongs to another parent identity");
  }
}

/** Fund a first budget for one heir under the parent's rule. */
async function prepareInitialFunding(input: InitialFundingInput): Promise<PreparedShieldedFunding> {
  assertFundingParent(input.wallet, input.policy.rootIdentityCommitment);
  const ctx = await currentContext(input);
  const expectedIndex = getAddress(await input.pool.LINEAGE_INDEX());
  if (expectedIndex.toLowerCase() !== (await input.lineageIndex.getAddress()).toLowerCase()) {
    throw new Error("Lineage index does not belong to this shielded pool");
  }
  const donor = donorInput(input, ctx.keys.ownerSecret);
  const policy = input.policy;
  const allocationKeyCommitment = computeShieldedAllocationKeyCommitment(policy.allocationKey, ctx);
  const policyCommitment = shieldedPolicyCommitment(policy, ctx);
  const { periods, amount } = fundingAmount(
    uint128(policy.amountPerPeriod, "rate"),
    input.budgetPeriods,
  );
  if (donor.note.amount < amount)
    throw new Error("Donor value note cannot fund the whole child budget");
  const heir = ctx.heir;
  const enrollmentNullifier = computeShieldedEnrollmentNullifier(
    {
      allocationKey: policy.allocationKey,
      policyCommitment,
      heirIdentityCommitment: heir.identityCommitment,
    },
    ctx,
  );
  if (input.wallet.spentNullifiers.has(enrollmentNullifier))
    throw new Error("This child is already enrolled under this policy");
  const latestBlock = ctx.latestBlock;
  if (input.lineage.blockNumber > latestBlock.number)
    throw new Error("Lineage snapshot is ahead of the chain");
  const [endorsementRoot, trustedRoot] = await Promise.all([
    input.lineageIndex.root(0, { blockTag: latestBlock.number }),
    input.lineageIndex.root(1, { blockTag: latestBlock.number }),
  ]);
  if (
    input.lineage.endorsementTree.root !== BigInt(endorsementRoot) ||
    input.lineage.trustedTree.root !== BigInt(trustedRoot)
  )
    throw new Error("Lineage snapshot roots are stale; replay public events");
  const asOf = uint64(latestBlock.timestamp, "asOf");
  const eligibleFrom = uint64(asOf + PROOF_LIFETIME, "eligibleFrom");
  const rootPersonHash = wrapIdentityCommitmentAsPersonHash(policy.rootIdentityCommitment);
  const rootVersion = input.lineage.versions
    .get(rootPersonHash.toLowerCase())
    ?.find((version) => BigInt(version.versionIndex) === getBigInt(policy.rootVersionIndex));
  if (!rootVersion || rootVersion.identityCommitment !== getBigInt(policy.rootIdentityCommitment)) {
    throw new Error("Policy root version is absent from the lineage snapshot");
  }
  const legitimacy = findHeirLegitimacy({
    snapshot: input.lineage,
    heir: { personHash: heir.personHash, identityCommitment: heir.identityCommitment },
    root: { identityCommitment: getBigInt(policy.rootIdentityCommitment) },
    rootVersionIndex: Number(policy.rootVersionIndex),
  }).find((candidate) => candidate.writtenAt <= asOf);
  if (!legitimacy)
    throw new Error("Heir has no current direct-child endorsement from a trusted source");
  const endorsementProof = input.lineage.endorsementTree.generateProof(
    legitimacy.endorsementLeafIndex,
  );
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
    endorsementProof.leaf !== endorsementLeaf ||
    trustedProof.leaf !== trustedLeaf ||
    endorsementProof.siblings.length > 64 ||
    trustedProof.siblings.length > 64
  )
    throw new Error("Lineage proof does not match active endorsement and trust leaves");
  const enrollmentSalt = generateShieldedRandomField();
  const enrollmentCommitment = computeShieldedEnrollmentCommitment(
    {
      policyCommitment,
      heirIdentityCommitment: heir.identityCommitment,
      eligibleFrom,
      enrollmentSalt,
    },
    ctx,
  );
  const ruleOpening = {
    policySalt: getBigInt(policy.policySalt),
    allocationKeyCommitment,
    enrollmentSalt,
  };
  const budget: ShieldedBudgetNotePayload =
    input.budgetKind === 1
      ? {
          binding: "identity",
          rootIdentityCommitment: policy.rootIdentityCommitment,
          rootVersionIndex: policy.rootVersionIndex,
          heirIdentityCommitment: heir.identityCommitment,
          amountPerPeriod: policy.amountPerPeriod,
          periodDays: policy.periodDays,
          eligibleFrom,
          policyCommitment,
          enrollmentCommitment,
          remaining: amount,
          nonce: generateShieldedRandomField(),
        }
      : {
          rootIdentityCommitment: policy.rootIdentityCommitment,
          rootVersionIndex: policy.rootVersionIndex,
          ...ruleOpening,
          heirIdentityCommitment: heir.identityCommitment,
          eligibleFrom,
          heirOwnerCommitment: heir.ownerCommitment,
          amountPerPeriod: policy.amountPerPeriod,
          periodDays: policy.periodDays,
          remaining: amount,
          nonce: generateShieldedRandomField(),
        };
  const outputs = await fundingOutputs({
    budget,
    donorOwnerCommitment: ctx.keys.ownerCommitment,
    donorChangeAmount: donor.note.amount - amount,
    heirViewingKey: heir.viewingKey ? getBytes(heir.viewingKey) : undefined,
    publicDelivery: input.budgetKind === 1,
    ...(budget.binding === "identity" ? { ruleOpening } : {}),
    donorViewIkm: ctx.keys.hpkeIkm,
    chainId: ctx.chainId,
    poolAddress: ctx.poolAddress,
    policyCommitment,
    enrollmentCommitment,
    allocationKey: policy.allocationKey,
  });
  const data = actionData({
    fundMode: 0,
    budgetKind: input.budgetKind ?? 0,
    donor,
    useNullifier: enrollmentNullifier,
    outputs,
    relation0: BigInt(endorsementRoot),
    relation1: BigInt(trustedRoot),
    asOf,
  });
  const witness: ShieldedWitness = {
    ...publicInputs(SHIELDED_POOL_ACTION.Fund, ctx.chainId, ctx.poolAddress, data),
    ...ZERO_TEMPLATE_WITNESS,
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
    periodDays: String(policy.periodDays),
    policySalt: String(policy.policySalt),
    allocationKey: String(policy.allocationKey),
    allocationKeyCommitment: String(allocationKeyCommitment),
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
    endorsementSiblings: decimal([
      ...endorsementProof.siblings,
      ...Array<bigint>(64 - endorsementProof.siblings.length).fill(0n),
    ]),
    trustedDepth: trustedProof.siblings.length,
    trustedIndex: String(trustedProof.index),
    trustedSiblings: decimal([
      ...trustedProof.siblings,
      ...Array<bigint>(64 - trustedProof.siblings.length).fill(0n),
    ]),
    eligibleFrom: String(eligibleFrom),
    enrollmentSalt: String(enrollmentSalt),
    budgetPeriods: String(periods),
    budgetNonce: String(budget.nonce),
    changeNonce: String(outputs[1].note.nonce),
  };
  return { data, witness, policyCommitment, outputs };
}

/** Add a new whole-period budget using a saved child budget as read-only template. */
async function prepareContinuationFunding(
  input: ContinuationFundingInput,
): Promise<PreparedShieldedFunding> {
  assertFundingParent(input.wallet, input.budget.note.rootIdentityCommitment);
  const ctx = await currentContext(input);
  const donor = donorInput(input, ctx.keys.ownerSecret);
  const template = templatePath(input.wallet, input.budget, encodeShieldedBudgetNotePayload);
  const old = input.budget.note;
  const heir = ctx.heir;
  if (
    getBigInt(old.heirIdentityCommitment) !== heir.identityCommitment ||
    (input.budgetKind !== 1 &&
      old.binding !== "identity" &&
      getBigInt(old.heirOwnerCommitment) !== heir.ownerCommitment)
  )
    throw new Error("Budget template does not belong to this recipient");
  const ruleOpening =
    old.binding === "identity"
      ? input.budget.ruleOpening
      : {
          policySalt: getBigInt(old.policySalt),
          allocationKeyCommitment: getBigInt(old.allocationKeyCommitment),
          enrollmentSalt: getBigInt(old.enrollmentSalt),
        };
  if (!ruleOpening) throw new Error("Identity budget funding needs its donor rule opening");
  const rate = uint128(old.amountPerPeriod, "rate");
  const periodDays = positiveUint32(old.periodDays, "periodDays");
  const oldRemaining = uint128(old.remaining, "old remaining budget");
  if (rate === 0n || oldRemaining % rate !== 0n)
    throw new Error("Template budget has fractional periods");
  const { periods, amount } = fundingAmount(rate, input.budgetPeriods);
  if (donor.note.amount < amount)
    throw new Error("Donor value note cannot fund the full additional amount");
  const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(old, ctx);
  if (
    computeShieldedPolicyCommitment({ ...old, ...ruleOpening }, ctx) !== policyCommitment ||
    computeShieldedEnrollmentCommitment({ ...old, ...ruleOpening, policyCommitment }, ctx) !==
      enrollmentCommitment
  )
    throw new Error("Funding rule opening does not match this budget");
  const budgetUseNonce = generateShieldedRandomField();
  const useNullifier = computeShieldedBudgetUseNullifier(
    {
      policySalt: ruleOpening.policySalt,
      budgetNoteCommitment: template.commitment,
      useNonce: budgetUseNonce,
    },
    ctx,
  );
  if (input.wallet.spentNullifiers.has(useNullifier))
    throw new Error("Funding authorization was already used");
  const commonBudget = {
    rootIdentityCommitment: old.rootIdentityCommitment,
    rootVersionIndex: old.rootVersionIndex,
    heirIdentityCommitment: old.heirIdentityCommitment,
    amountPerPeriod: old.amountPerPeriod,
    periodDays,
    eligibleFrom: old.eligibleFrom,
    remaining: amount,
    nonce: generateShieldedRandomField(),
  };
  const budget: ShieldedBudgetNotePayload =
    input.budgetKind === 1
      ? { ...commonBudget, binding: "identity", policyCommitment, enrollmentCommitment }
      : { ...commonBudget, ...ruleOpening, heirOwnerCommitment: heir.ownerCommitment };
  const outputs = await fundingOutputs({
    budget,
    donorOwnerCommitment: ctx.keys.ownerCommitment,
    donorChangeAmount: donor.note.amount - amount,
    heirViewingKey: heir.viewingKey ? getBytes(heir.viewingKey) : undefined,
    publicDelivery: input.budgetKind === 1,
    ...(budget.binding === "identity" ? { ruleOpening } : {}),
    donorViewIkm: ctx.keys.hpkeIkm,
    chainId: ctx.chainId,
    poolAddress: ctx.poolAddress,
    policyCommitment,
    enrollmentCommitment,
  });
  const data = actionData({
    fundMode: 1,
    budgetKind: input.budgetKind ?? 0,
    donor,
    template,
    useNullifier,
    outputs,
  });
  const witness: ShieldedWitness = {
    ...publicInputs(SHIELDED_POOL_ACTION.Fund, ctx.chainId, ctx.poolAddress, data),
    ...ZERO_LINEAGE_WITNESS,
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
    periodDays: String(periodDays),
    policySalt: String(ruleOpening.policySalt),
    allocationKeyCommitment: String(ruleOpening.allocationKeyCommitment),
    heirIdentityCommitment: String(heir.identityCommitment),
    heirOwnerCommitment: String(heir.ownerCommitment),
    eligibleFrom: String(old.eligibleFrom),
    enrollmentSalt: String(ruleOpening.enrollmentSalt),
    oldBudgetKind: old.binding === "identity" ? "1" : "0",
    oldHeirOwnerCommitment: old.binding === "identity" ? "0" : String(old.heirOwnerCommitment),
    oldBudgetRemaining: String(oldRemaining),
    oldBudgetRemainingPeriods: String(oldRemaining / rate),
    oldBudgetNonce: String(old.nonce),
    oldBudgetCiphertextHash: String(template.ciphertextHash),
    oldBudgetDepth: template.depth,
    oldBudgetIndex: String(template.index),
    oldBudgetSiblings: decimal(template.siblings),
    budgetUseNonce: String(budgetUseNonce),
    budgetPeriods: String(periods),
    budgetNonce: String(budget.nonce),
    changeNonce: String(outputs[1].note.nonce),
  };
  return { data, witness, policyCommitment, outputs };
}
