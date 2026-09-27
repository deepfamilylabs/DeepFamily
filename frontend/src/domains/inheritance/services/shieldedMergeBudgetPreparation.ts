import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicSignals,
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  type ShieldedBudgetNotePayload,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import {
  getRecoveredShieldedNoteProof,
  type LocalShieldedWalletSnapshot,
} from "./shieldedWalletRecovery";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

type PreparedOutput<T> = {
  /** This plaintext remains on the device; only its ciphertext and commitment go on chain. */
  note: T;
  commitment: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
};

export type PrepareShieldedMergeBudgetInput = {
  chainId: BigNumberish;
  poolAddress: string;
  derivedSecretField: BigNumberish;
  /** Recovered locally from the public pool events and this identity's viewing key. */
  wallet: LocalShieldedWalletSnapshot;
  inputCommitments: readonly [BigNumberish, BigNumberish];
};

export type PreparedShieldedMergeBudget = {
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  policyCommitment: bigint;
  enrollmentCommitment: bigint;
  outputs: readonly [PreparedOutput<ShieldedBudgetNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
};

function uint64(value: BigNumberish, name: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT64) throw new Error(`${name} must fit in uint64`);
  return parsed;
}

function sameBudgetIdentity(
  a: ShieldedBudgetNotePayload,
  b: ShieldedBudgetNotePayload,
): boolean {
  return a.rootIdentityCommitment === b.rootIdentityCommitment &&
    a.rootVersionIndex === b.rootVersionIndex &&
    a.policySalt === b.policySalt &&
    a.allocationKeyCommitment === b.allocationKeyCommitment &&
    a.heirIdentityCommitment === b.heirIdentityCommitment &&
    a.eligibleFrom === b.eligibleFrom &&
    a.enrollmentSalt === b.enrollmentSalt &&
    a.heirOwnerCommitment === b.heirOwnerCommitment &&
    a.amountPerPeriod === b.amountPerPeriod;
}

async function openInput(
  wallet: LocalShieldedWalletSnapshot,
  commitment: bigint,
  ownerSecret: bigint,
  ownerCommitment: bigint,
  hpkeIkm: string,
  chainId: bigint,
  poolAddress: string,
) {
  const owned = wallet.ownedNotes.get(commitment);
  if (!owned || owned.note.kind !== "budget") {
    throw new Error("Both merge inputs must be locally recovered budget notes");
  }
  const note = owned.note;
  if (note.heirOwnerCommitment !== ownerCommitment ||
    (wallet.walletIdentityCommitment !== undefined &&
      note.heirIdentityCommitment !== wallet.walletIdentityCommitment)) {
    throw new Error("Budget note belongs to another heir");
  }
  const ciphertextHashField = computeShieldedCiphertextHashField(owned.ciphertext);
  if (ciphertextHashField !== owned.ciphertextHashField) {
    throw new Error("Budget note does not match its public ciphertext");
  }
  const payload = encodeShieldedBudgetNotePayload(note);
  let opened: Uint8Array | undefined;
  try {
    opened = await decryptShieldedNote({
      hpkeIkm: getBytes(hpkeIkm),
      ciphertext: owned.ciphertext,
      chainId,
      poolAddress,
    });
    if (opened.length !== payload.length || opened.some((byte, index) => byte !== payload[index])) {
      throw new Error("Recovered budget ciphertext does not contain its selected plaintext");
    }
    verifyShieldedNotePayload({ payload: opened, ciphertext: owned.ciphertext, noteCommitment: commitment });
  } finally {
    payload.fill(0);
    opened?.fill(0);
  }
  const nullifier = computeShieldedSpendNullifier({ ownerSecret, noteCommitment: commitment });
  if (wallet.spentNullifiers.has(nullifier)) throw new Error("Budget note has already been spent");
  const path = getRecoveredShieldedNoteProof(wallet, commitment);
  return { note, ciphertextHashField, nullifier, path };
}

async function encryptOwnOutput<T extends ShieldedBudgetNotePayload | ShieldedValueNotePayload>(
  note: T,
  encode: (value: T) => Uint8Array,
  commitment: (ciphertextHashField: bigint) => bigint,
  viewingKey: Uint8Array,
  hpkeIkm: string,
  chainId: bigint,
  poolAddress: string,
): Promise<PreparedOutput<T>> {
  const payload = encode(note);
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
    if (opened.length !== payload.length || opened.some((byte, index) => byte !== payload[index])) {
      throw new Error("Merged output did not decrypt to its intended plaintext");
    }
    verifyShieldedNotePayload({ payload: opened, ciphertext, noteCommitment });
    return { note, commitment: noteCommitment, ciphertext, ciphertextHashField };
  } finally {
    payload.fill(0);
    opened?.fill(0);
  }
}

/**
 * Prepare an entirely local two-budget merge. Refresh the public wallet replay
 * before proving; a competing spend causes the eventual pool transaction to
 * revert. The witness and plaintext notes must never be sent to an RPC.
 */
export async function prepareShieldedMergeBudget(
  input: PrepareShieldedMergeBudgetInput,
): Promise<PreparedShieldedMergeBudget> {
  const chainId = uint64(input.chainId, "chainId");
  const poolAddress = getAddress(input.poolAddress);
  if (input.wallet.invalidated ||
    input.wallet.chainId !== chainId ||
    input.wallet.poolAddress.toLowerCase() !== poolAddress.toLowerCase()) {
    throw new Error("Shielded wallet does not match this chain or pool");
  }
  const keys = deriveShieldedHeirKeyMaterial(input.derivedSecretField);
  if (input.wallet.walletOwnerCommitment !== keys.ownerCommitment) {
    throw new Error("Shielded wallet does not match this identity");
  }
  if (input.inputCommitments.length !== 2) {
    throw new Error("Merge requires exactly two budget note commitments");
  }
  const commitments = input.inputCommitments.map((value) => getBigInt(value)) as [bigint, bigint];
  if (commitments[0] === commitments[1]) {
    throw new Error("Merge requires two distinct budget notes");
  }
  const notes = await Promise.all(commitments.map((commitment) => openInput(
    input.wallet,
    commitment,
    keys.ownerSecret,
    keys.ownerCommitment,
    keys.hpkeIkm,
    chainId,
    poolAddress,
  ))) as [Awaited<ReturnType<typeof openInput>>, Awaited<ReturnType<typeof openInput>>];
  const [first, second] = notes;
  if (!sameBudgetIdentity(first.note, second.note)) {
    throw new Error("Budgets must share one policy, enrollment, heir owner, and period rate");
  }
  const policyCommitment = computeShieldedPolicyCommitment(first.note);
  const enrollmentCommitment = computeShieldedEnrollmentCommitment({
    policyCommitment,
    heirIdentityCommitment: first.note.heirIdentityCommitment,
    eligibleFrom: first.note.eligibleFrom,
    enrollmentSalt: first.note.enrollmentSalt,
  });
  const rate = getBigInt(first.note.amountPerPeriod);
  const remaining = notes.map(({ note }) => getBigInt(note.remaining)) as [bigint, bigint];
  const remainingPeriods = remaining.map((value) => value / rate) as [bigint, bigint];
  const mergedRemaining = remaining[0] + remaining[1];
  const mergedPeriods = remainingPeriods[0] + remainingPeriods[1];
  if (mergedRemaining > MAX_UINT128 || mergedPeriods > MAX_UINT64) {
    throw new Error("Merged budget exceeds the circuit's amount or period limit");
  }
  const merged: ShieldedBudgetNotePayload = {
    ...first.note,
    remaining: mergedRemaining,
    nonce: generateShieldedRandomField(),
  };
  const dummy: ShieldedValueNotePayload = {
    ownerCommitment: keys.ownerCommitment,
    amount: 0n,
    nonce: generateShieldedRandomField(),
  };
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const outputs = await Promise.all([
    encryptOwnOutput(
      merged,
      encodeShieldedBudgetNotePayload,
      (ciphertextHashField) => computeShieldedBudgetNoteCommitment({
        policyCommitment,
        enrollmentCommitment,
        heirOwnerCommitment: keys.ownerCommitment,
        amountPerPeriod: rate,
        remaining: mergedRemaining,
        nonce: merged.nonce,
        ciphertextHashField,
      }),
      viewingKey,
      keys.hpkeIkm,
      chainId,
      poolAddress,
    ),
    encryptOwnOutput(
      dummy,
      encodeShieldedValueNotePayload,
      (ciphertextHashField) => computeShieldedValueNoteCommitment({ ...dummy, ciphertextHashField }),
      viewingKey,
      keys.hpkeIkm,
      chainId,
      poolAddress,
    ),
  ]) as [PreparedOutput<ShieldedBudgetNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
  const data = {
    inputShardIds: [first.path.shardId, second.path.shardId],
    inputRoots: [first.path.root, second.path.root],
    inputNullifiers: [first.nullifier, second.nullifier],
    periodNullifiers: Array<bigint>(12).fill(0n),
    outputCommitments: [outputs[0].commitment, outputs[1].commitment],
    outputCiphertexts: [outputs[0].ciphertext, outputs[1].ciphertext],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
    registryRoot: 0n,
    registryShardId: 0n,
  } satisfies ShieldedPoolActionData;
  const publicSignals = buildShieldedPoolPublicSignals({
    action: SHIELDED_POOL_ACTION.MergeBudget,
    chainId,
    poolAddress,
    ...data,
  });
  const decimal = (values: readonly bigint[]) => values.map(String);
  const witness: ShieldedWitness = {
    publicSignals: decimal(publicSignals),
    ownerSecret: String(keys.ownerSecret),
    policyCommitment: String(policyCommitment),
    enrollmentCommitment: String(enrollmentCommitment),
    rate: String(rate),
    remaining: decimal(remaining),
    remainingPeriods: decimal(remainingPeriods),
    inputNonces: notes.map(({ note }) => String(note.nonce)),
    inputCiphertextHashes: notes.map(({ ciphertextHashField }) => String(ciphertextHashField)),
    inputDepths: notes.map(({ path }) => String(path.proofDepth)),
    inputIndices: notes.map(({ path }) => String(path.proofIndex)),
    inputSiblings: notes.map(({ path }) => decimal(path.siblings)),
    mergedNonce: String(merged.nonce),
    dummyNonce: String(dummy.nonce),
  };
  return { data, witness, policyCommitment, enrollmentCommitment, outputs };
}
