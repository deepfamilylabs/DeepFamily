import {
  SHIELDED_POOL_ACTION,
  buildLineageMerkleProof,
  buildShieldedPoolPublicInputs,
  computeIdentityFromDerivedSecret,
  computeShieldedNoteCommitmentFromPayload,
  getShieldedBudgetCommitments,
  normalizeShieldedKeyMode,
  normalizeShieldedBudgetOrigin,
  splitShieldedViewPublicKey,
  computeShieldedCiphertextHashField,
  computeShieldedClaimBatch,
  computeShieldedDummyInputNullifier,
  computeShieldedDummyPeriodNullifier,
  computeShieldedPeriodNullifier,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  type ShieldedBudgetNotePayload,
  type ShieldedScope,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish } from "ethers";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import { findHeirLegitimacy, type HeirLegitimacy, type LineageSnapshot } from "./inheritanceChain";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";
import { getLocalShieldedNoteProof } from "./shieldedPoolChain";

import {
  validateShieldedClaimKeyMaterial,
  type ShieldedKeyMaterial,
} from "./shieldedKeyAuthorization";

const MAX_UINT64 = (1n << 64n) - 1n;
const ZERO_PERIODS = Array<bigint>(12).fill(0n);

type ClaimOutput<T> = {
  /** Plaintext stays on this device; only commitment and ciphertext are submitted. */
  note: T;
  commitment: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
};

export type PrepareShieldedClaimInput = {
  chainId: BigNumberish;
  poolAddress: string;
  identity: IdentityMaterialV1Result;
  keyMaterial: ShieldedKeyMaterial;
  wallet: LocalShieldedWalletSnapshot;
  /** Reconstructed from unfiltered public events at one checkpoint and block. */
  lineage: LineageSnapshot;
  budgetCommitment: BigNumberish;
  secondBudgetCommitment?: BigNumberish;
  /** Defaults to the lineage snapshot timestamp; the pool enforces its recency. */
  asOf?: BigNumberish;
  /** Strictly increasing, due period indices, with 1–12 entries. */
  periodIndices: readonly BigNumberish[];
  /** Optional choice when several current direct-child endorsements are valid. */
  source?: { endorser: string; versionIndex: number };
};

export type PreparedShieldedClaim = {
  amount: bigint;
  policyCommitment: bigint;
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  outputs: readonly [ClaimOutput<ShieldedBudgetNotePayload>, ClaimOutput<ShieldedValueNotePayload>];
};

function checkedUint64(value: BigNumberish, label: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT64) throw new Error(`${label} must fit in uint64`);
  return parsed;
}

function sameWallet(
  wallet: LocalShieldedWalletSnapshot,
  chainId: bigint,
  poolAddress: string,
  ownerCommitment: bigint,
  identityCommitment: bigint,
): void {
  if (
    wallet.invalidated ||
    wallet.chainId !== chainId ||
    wallet.poolAddress.toLowerCase() !== poolAddress.toLowerCase() ||
    wallet.walletOwnerCommitment !== ownerCommitment ||
    (wallet.walletIdentityCommitment !== undefined &&
      wallet.walletIdentityCommitment !== identityCommitment)
  ) {
    throw new Error("Shielded wallet does not match this identity, chain, or pool");
  }
}

function currentSource(
  lineage: LineageSnapshot,
  heir: { personHash: string; identityCommitment: bigint },
  note: { rootIdentityCommitment: bigint; rootVersionIndex: bigint },
  selected?: PrepareShieldedClaimInput["source"],
): HeirLegitimacy {
  if (note.rootVersionIndex > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Root version index is outside the local lineage index range");
  }
  const candidates = findHeirLegitimacy({
    snapshot: lineage,
    heir,
    root: { identityCommitment: note.rootIdentityCommitment },
    rootVersionIndex: Number(note.rootVersionIndex),
  });
  const source = selected
    ? candidates.find(
        (candidate) =>
          candidate.versionIndex === selected.versionIndex &&
          candidate.endorser.toLowerCase() === selected.endorser.toLowerCase(),
      )
    : candidates[0];
  if (!source) {
    throw new Error("No current direct-child endorsement and trusted source match this budget");
  }
  return source;
}

async function encryptOwnOutput<T extends ShieldedBudgetNotePayload | ShieldedValueNotePayload>(
  note: T,
  encode: (value: T, scope: ShieldedScope) => Uint8Array,
  commitment: (ciphertextHashField: bigint) => bigint,
  viewingKey: Uint8Array,
  hpkeIkm: string,
  chainId: bigint,
  poolAddress: string,
): Promise<ClaimOutput<T>> {
  const payload = encode(note, { chainId, poolAddress, viewingKey });
  let opened: Uint8Array | undefined;
  try {
    const ciphertext = await encryptShieldedNote({
      recipientPublicKey: viewingKey,
      payload,
      chainId,
      poolAddress,
    });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    const noteCommitment = commitment(ciphertextHashField);
    opened = await decryptShieldedNote({
      hpkeIkm: getBytes(hpkeIkm),
      ciphertext,
      chainId,
      poolAddress,
    });
    const recovered = verifyShieldedNotePayload(
      {
        payload: opened,
        ciphertext,
        noteCommitment,
      },
      { chainId, poolAddress, viewingKey },
    );
    if (recovered.noteCommitment !== noteCommitment) {
      throw new Error("Locally encrypted claim output does not match its commitment");
    }
    return { note, commitment: noteCommitment, ciphertext, ciphertextHashField };
  } finally {
    payload.fill(0);
    opened?.fill(0);
  }
}

/**
 * Build a claim entirely from local plaintext and locally replayed public trees.
 * The snapshot checkpoint remains usable for its bounded retirement window.
 * The witness and private notes must never be sent to a server or RPC.
 */
export async function prepareShieldedClaim(
  input: PrepareShieldedClaimInput,
): Promise<PreparedShieldedClaim> {
  const chainId = checkedUint64(input.chainId, "chainId");
  const poolAddress = getAddress(input.poolAddress);
  const asOf = checkedUint64(input.asOf ?? input.lineage.timestamp, "asOf");
  const lineageCheckpointId = getBigInt(input.lineage.checkpointId);
  if (lineageCheckpointId <= 0n) throw new Error("A valid family eligibility snapshot is required");
  if (asOf < input.lineage.checkpointCreatedAt || asOf > input.lineage.timestamp)
    throw new Error("Claim time is outside the family eligibility snapshot");
  const material = computeIdentityFromDerivedSecret({
    identity: input.identity.identity,
    identitySuiteId: input.identity.identitySuiteId,
    derivedSecretField: input.identity.derivedSecretField,
  });
  if (
    material.identityCommitment !== BigInt(input.identity.identityCommitment) ||
    material.nameField !== BigInt(input.identity.nameField) ||
    material.packedBirthGenderField !== BigInt(input.identity.packedBirthGenderField) ||
    material.suiteCommitment !== BigInt(input.identity.suiteCommitment) ||
    material.personHash.toLowerCase() !== input.identity.personHash.toLowerCase()
  ) {
    throw new Error("Identity material does not match the passphrase-derived secret");
  }
  const budgetCommitment = getBigInt(input.budgetCommitment);
  const owned = input.wallet.ownedNotes.get(budgetCommitment);
  if (!owned || owned.note.kind !== "budget") {
    throw new Error("Input must be a locally recovered budget note");
  }
  const budget = owned.note;
  const keyMode = normalizeShieldedKeyMode(budget.keyMode, budget.binding);
  const keys = validateShieldedClaimKeyMaterial(
    input.keyMaterial,
    keyMode,
    material.derivedSecretField,
  );
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const scope = { chainId, poolAddress, viewingKey };
  sameWallet(input.wallet, chainId, poolAddress, keys.ownerCommitment, material.identityCommitment);
  if (
    budget.heirIdentityCommitment !== material.identityCommitment ||
    (budget.binding !== "identity" && budget.heirOwnerCommitment !== keys.ownerCommitment)
  ) {
    throw new Error("Budget note belongs to another heir");
  }
  const budgetCiphertextHash = computeShieldedCiphertextHashField(owned.ciphertext);
  const { policyCommitment, enrollmentCommitment } = getShieldedBudgetCommitments(budget, {
    chainId,
    poolAddress,
  });
  const budgetPayload = encodeShieldedBudgetNotePayload(budget, scope);
  try {
    verifyShieldedNotePayload(
      {
        payload: budgetPayload,
        ciphertext: owned.ciphertext,
        noteCommitment: budgetCommitment,
      },
      scope,
    );
  } finally {
    budgetPayload.fill(0);
  }
  if (budgetCiphertextHash !== owned.ciphertextHashField)
    throw new Error("Budget note does not match its public ciphertext and commitment");
  const spend = computeShieldedSpendNullifier(
    {
      ownerSecret: keys.ownerSecret,
      noteCommitment: budgetCommitment,
    },
    { chainId, poolAddress },
  );
  const dummySpend = computeShieldedDummyInputNullifier(
    {
      ownerSecret: keys.ownerSecret,
      noteCommitment: budgetCommitment,
    },
    { chainId, poolAddress },
  );
  if (input.wallet.spentNullifiers.has(spend) || input.wallet.spentNullifiers.has(dummySpend)) {
    throw new Error("Budget note has already been spent");
  }
  const secondCommitment =
    input.secondBudgetCommitment === undefined
      ? undefined
      : getBigInt(input.secondBudgetCommitment);
  if (secondCommitment === budgetCommitment) throw new Error("Claim needs distinct budget notes");
  const secondOwned =
    secondCommitment === undefined ? undefined : input.wallet.ownedNotes.get(secondCommitment);
  if (secondCommitment !== undefined && (!secondOwned || secondOwned.note.kind !== "budget")) {
    throw new Error("Second input must be a locally recovered budget note");
  }
  const secondBudget = secondOwned?.note.kind === "budget" ? secondOwned.note : undefined;
  let secondSpend: bigint | undefined;
  let secondHash = 0n;
  let secondPath: ReturnType<typeof getLocalShieldedNoteProof> | undefined;
  if (secondBudget && secondOwned && secondCommitment !== undefined) {
    if (
      (secondBudget.binding === "identity") !== (budget.binding === "identity") ||
      normalizeShieldedKeyMode(secondBudget.keyMode, secondBudget.binding) !== keyMode
    )
      throw new Error("Claim budgets must retain the same binding and key mode");
    for (const field of [
      "rootIdentityCommitment",
      "rootVersionIndex",
      "heirIdentityCommitment",
      "eligibleFrom",
      "amountPerPeriod",
      "periodDays",
    ] as const) {
      if (secondBudget[field] !== budget[field])
        throw new Error("Claim budgets must share policy, enrollment, owner, and rate");
    }
    const secondRule = getShieldedBudgetCommitments(secondBudget, { chainId, poolAddress });
    if (
      secondRule.policyCommitment !== policyCommitment ||
      secondRule.enrollmentCommitment !== enrollmentCommitment ||
      (secondBudget.binding !== "identity" &&
        secondBudget.heirOwnerCommitment !== keys.ownerCommitment)
    )
      throw new Error("Claim budgets must share policy, enrollment, owner, and rate");
    const payload = encodeShieldedBudgetNotePayload(secondBudget, scope);
    try {
      verifyShieldedNotePayload(
        {
          payload,
          ciphertext: secondOwned.ciphertext,
          noteCommitment: secondCommitment,
        },
        scope,
      );
    } finally {
      payload.fill(0);
    }
    secondHash = computeShieldedCiphertextHashField(secondOwned.ciphertext);
    if (secondHash !== secondOwned.ciphertextHashField)
      throw new Error("Second budget does not match its public ciphertext");
    secondSpend = computeShieldedSpendNullifier(
      {
        ownerSecret: keys.ownerSecret,
        noteCommitment: secondCommitment,
      },
      { chainId, poolAddress },
    );
    if (input.wallet.spentNullifiers.has(secondSpend))
      throw new Error("Second budget note has already been spent");
    secondPath = getLocalShieldedNoteProof(input.wallet, secondCommitment);
  }
  const combinedRemaining = budget.remaining + (secondBudget?.remaining ?? 0n);
  if (combinedRemaining / budget.amountPerPeriod > MAX_UINT64)
    throw new Error("Combined budget exceeds the period limit");
  const batch = computeShieldedClaimBatch({
    amountPerPeriod: budget.amountPerPeriod,
    periodDays: budget.periodDays,
    remaining: combinedRemaining,
    eligibleFrom: budget.eligibleFrom,
    now: asOf,
    periodIndices: [...input.periodIndices],
  });
  const periodNullifiers = ZERO_PERIODS.map((_, slot) =>
    slot < batch.periodIndices.length
      ? computeShieldedPeriodNullifier(
          {
            derivedSecretField: material.derivedSecretField,
            policyCommitment,
            periodIndex: batch.periodIndices[slot],
          },
          { chainId, poolAddress },
        )
      : computeShieldedDummyPeriodNullifier(
          {
            ownerSecret: keys.ownerSecret,
            budgetNoteCommitment: budgetCommitment,
            slotIndex: slot,
          },
          { chainId, poolAddress },
        ),
  );
  if (periodNullifiers.some((tag) => input.wallet.spentNullifiers.has(tag))) {
    throw new Error("A requested claim period has already been used");
  }
  const source = currentSource(
    input.lineage,
    { personHash: material.personHash, identityCommitment: material.identityCommitment },
    budget,
    input.source,
  );
  if (source.writtenAt > asOf) {
    throw new Error("Current endorsement was written after the selected claim time");
  }
  const endorsement = buildLineageMerkleProof(
    input.lineage.endorsementTree,
    source.endorsementLeafIndex,
  );
  const trusted = buildLineageMerkleProof(input.lineage.trustedTree, source.trustedLeafIndex);
  if (endorsement.root === 0n || trusted.root === 0n) {
    throw new Error("Both current lineage roots must be nonzero");
  }
  const path = getLocalShieldedNoteProof(input.wallet, budgetCommitment);
  const ownerBudget = budget.binding !== "identity" ? budget : undefined;
  const budgetOutput: ShieldedBudgetNotePayload = {
    ...budget,
    ...(budget.binding === "identity" ? {} : { budgetOrigin: 1n, viewingKey }),
    remaining: batch.remaining,
    nonce: generateShieldedRandomField(),
  };
  const payoutOutput: ShieldedValueNotePayload = {
    ownerCommitment: keys.ownerCommitment,
    amount: batch.amount,
    nonce: generateShieldedRandomField(),
  };
  const outputs = (await Promise.all([
    encryptOwnOutput(
      budgetOutput,
      encodeShieldedBudgetNotePayload,
      (ciphertextHashField) => {
        const payload = encodeShieldedBudgetNotePayload(budgetOutput, scope);
        try {
          return computeShieldedNoteCommitmentFromPayload({ payload, ciphertextHashField }, scope)
            .noteCommitment;
        } finally {
          payload.fill(0);
        }
      },
      viewingKey,
      keys.hpkeIkm,
      chainId,
      poolAddress,
    ),
    encryptOwnOutput(
      payoutOutput,
      encodeShieldedValueNotePayload,
      (ciphertextHashField) =>
        computeShieldedValueNoteCommitment(
          {
            ...payoutOutput,
            ciphertextHashField,
          },
          { chainId, poolAddress },
        ),
      viewingKey,
      keys.hpkeIkm,
      chainId,
      poolAddress,
    ),
  ])) as [ClaimOutput<ShieldedBudgetNotePayload>, ClaimOutput<ShieldedValueNotePayload>];
  const data = {
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: [path.shardId, secondPath?.shardId ?? path.shardId],
    inputRoots: [path.root, secondPath?.root ?? path.root],
    inputNullifiers: [spend, secondSpend ?? dummySpend],
    periodNullifiers,
    outputCommitments: [outputs[0].commitment, outputs[1].commitment],
    outputCiphertexts: [outputs[0].ciphertext, outputs[1].ciphertext],
    relation0: endorsement.root,
    relation1: trusted.root,
    asOf,
    lineageCheckpointId,
  } satisfies ShieldedPoolActionData;
  const { witness: publicInputs } = buildShieldedPoolPublicInputs({
    action: SHIELDED_POOL_ACTION.Claim,
    chainId,
    poolAddress,
    ...data,
  });
  const decimal = (values: readonly bigint[]) => values.map(String);
  const witness: ShieldedWitness = {
    ...publicInputs,
    budgetKind: budget.binding === "identity" ? "1" : "0",
    keyMode: String(keyMode),
    heirViewKeyLo: ownerBudget ? String(splitShieldedViewPublicKey(viewingKey).viewKeyLo) : "0",
    heirViewKeyHi: ownerBudget ? String(splitShieldedViewPublicKey(viewingKey).viewKeyHi) : "0",
    inputBudgetIsClaim: [
      ownerBudget ? String(normalizeShieldedBudgetOrigin(ownerBudget.budgetOrigin)) : "0",
      secondBudget && secondBudget.binding !== "identity"
        ? String(normalizeShieldedBudgetOrigin(secondBudget.budgetOrigin))
        : "0",
    ],
    ownerSecret: String(keys.ownerSecret),
    secondKeyMode: secondBudget ? String(keyMode) : "0",
    secondBudgetKind: secondBudget?.binding === "identity" ? "1" : "0",
    policyCommitmentInput: String(policyCommitment),
    enrollmentCommitmentInput: String(enrollmentCommitment),
    hasSecondInput: secondBudget ? "1" : "0",
    secondRemaining: String(secondBudget?.remaining ?? 0n),
    secondRemainingPeriods: String(
      secondBudget ? secondBudget.remaining / secondBudget.amountPerPeriod : 0n,
    ),
    secondBudgetNonce: String(secondBudget?.nonce ?? 0n),
    secondBudgetCiphertextHash: String(secondHash),
    secondNoteDepth: secondPath?.proofDepth ?? 0,
    secondNoteIndex: String(secondPath?.proofIndex ?? 0n),
    secondNoteSiblings: (secondPath?.siblings ?? Array<bigint>(32).fill(0n)).map(String),
    nameField: String(material.nameField),
    derivedSecretField: String(material.derivedSecretField),
    isBirthBC: Number(material.identity.isBirthBC),
    birthYear: material.identity.birthYear,
    birthMonth: material.identity.birthMonth,
    birthDay: material.identity.birthDay,
    gender: material.identity.gender,
    suiteId: material.identitySuiteId,
    versionIndex: String(source.versionIndex),
    fatherIdentityCommitment: String(source.fatherIdentityCommitment),
    motherIdentityCommitment: String(source.motherIdentityCommitment),
    rootIsMother: Number(source.rootIsMother),
    endorser: String(BigInt(source.endorser)),
    writtenAt: String(source.writtenAt),
    endorsementDepth: endorsement.depth,
    endorsementIndex: String(endorsement.index),
    endorsementSiblings: decimal(endorsement.siblings),
    rootVersionIndex: String(budget.rootVersionIndex),
    trustedDepth: trusted.depth,
    trustedIndex: String(trusted.index),
    trustedSiblings: decimal(trusted.siblings),
    policySalt: String(ownerBudget?.policySalt ?? 0n),
    allocationKeyCommitment: String(ownerBudget?.allocationKeyCommitment ?? 0n),
    enrollmentSalt: String(ownerBudget?.enrollmentSalt ?? 0n),
    eligibleFrom: String(budget.eligibleFrom),
    rate: String(budget.amountPerPeriod),
    periodDays: String(budget.periodDays),
    remaining: String(budget.remaining),
    remainingPeriods: String(budget.remaining / budget.amountPerPeriod),
    budgetNonce: String(budget.nonce),
    budgetCiphertextHash: String(budgetCiphertextHash),
    noteDepth: path.proofDepth,
    noteIndex: String(path.proofIndex),
    noteSiblings: decimal(path.siblings),
    claimCount: String(batch.periodIndices.length),
    periodIndices: decimal([
      ...batch.periodIndices,
      ...Array<bigint>(12 - batch.periodIndices.length).fill(0n),
    ]),
    newBudgetNonce: String(budgetOutput.nonce),
    payoutNonce: String(payoutOutput.nonce),
  };
  return { amount: batch.amount, policyCommitment, data, witness, outputs };
}
