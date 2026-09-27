import {
  SHIELDED_POOL_ACTION,
  buildShieldedHpkeAad,
  buildShieldedPoolPublicSignals,
  computeShieldedAllocationKeyCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedPolicyNoteCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedPolicyNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  type ShieldedPolicyNotePayload,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import { getRecoveredShieldedNoteProof, type LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const ZERO_PERIOD_NULLIFIERS = Array<bigint>(12).fill(0n);
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;

type CommonPreparationInput = {
  chainId: BigNumberish;
  poolAddress: string;
  /** Existing identity secret, derived on this device from the one identity passphrase. */
  derivedSecretField: BigNumberish;
};

type PreparedOutput<T> = {
  /** Keep this plaintext only in the local wallet; never submit it or the witness to an RPC. */
  note: T;
  commitment: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
};

export type PreparedShieldedShield = {
  amount: bigint;
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  outputs: readonly [PreparedOutput<ShieldedValueNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
};

export type PreparedShieldedCreatePolicy = {
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  policyCommitment: bigint;
  outputs: readonly [PreparedOutput<ShieldedPolicyNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
};

function decimal(values: readonly bigint[]): string[] {
  return values.map(String);
}

function assertUint128(value: BigNumberish, label: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT128) {
    throw new Error(`${label} must fit in uint128`);
  }
  return parsed;
}

function assertUint64(value: BigNumberish, label: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT64) {
    throw new Error(`${label} must fit in uint64`);
  }
  return parsed;
}

function context(input: CommonPreparationInput) {
  const chainId = assertUint64(input.chainId, "chainId");
  const poolAddress = getAddress(input.poolAddress);
  buildShieldedHpkeAad({ chainId, poolAddress });
  const keys = deriveShieldedHeirKeyMaterial(input.derivedSecretField);
  return { chainId, poolAddress, keys };
}

/**
 * Confirm that an output decrypts with this identity and that its plaintext
 * recomputes the commitment bound to the exact ciphertext being published.
 */
async function encryptOwnOutput<T extends ShieldedValueNotePayload | ShieldedPolicyNotePayload>(
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
      throw new Error("Shielded output did not decrypt to its intended note");
    }
    verifyShieldedNotePayload({ payload: opened, ciphertext, noteCommitment });
    return { note, commitment: noteCommitment, ciphertext, ciphertextHashField };
  } finally {
    payload.fill(0);
    opened?.fill(0);
  }
}

function emptyActionData(
  outputs: readonly [PreparedOutput<unknown>, PreparedOutput<unknown>],
): ShieldedPoolActionData {
  return {
    inputShardIds: [0n, 0n],
    inputRoots: [0n, 0n],
    inputNullifiers: [0n, 0n],
    periodNullifiers: [...ZERO_PERIOD_NULLIFIERS],
    outputCommitments: [outputs[0].commitment, outputs[1].commitment],
    outputCiphertexts: [outputs[0].ciphertext, outputs[1].ciphertext],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
    registryRoot: 0n,
    registryShardId: 0n,
  };
}

function publicSignalsFor(
  action: number,
  chainId: bigint,
  poolAddress: string,
  data: ShieldedPoolActionData,
  amount = 0n,
): bigint[] {
  return buildShieldedPoolPublicSignals({
    action,
    chainId,
    poolAddress,
    inputShardIds: [...data.inputShardIds],
    inputRoots: [...data.inputRoots],
    inputNullifiers: [...data.inputNullifiers],
    periodNullifiers: [...data.periodNullifiers],
    outputCommitments: [...data.outputCommitments],
    outputCiphertexts: [...data.outputCiphertexts],
    amount,
    relation0: data.relation0,
    relation1: data.relation1,
    asOf: data.asOf,
    registryRoot: data.registryRoot,
    registryShardId: data.registryShardId,
  });
}

/**
 * Prepare both private outputs of a public DEEP deposit. A zero amount in one
 * output still gets its own random nonce and recoverable HPKE ciphertext.
 */
export async function prepareShieldedShield(
  input: CommonPreparationInput & {
    amount: BigNumberish;
    outputAmounts?: readonly [BigNumberish, BigNumberish];
  },
): Promise<PreparedShieldedShield> {
  const { chainId, poolAddress, keys } = context(input);
  const amount = assertUint128(input.amount, "amount");
  if (amount === 0n) throw new Error("Shield amount must be positive");
  const outputAmounts: readonly [bigint, bigint] = input.outputAmounts
    ? [assertUint128(input.outputAmounts[0], "outputAmounts[0]"), assertUint128(input.outputAmounts[1], "outputAmounts[1]")]
    : [amount, 0n];
  if (outputAmounts[0] + outputAmounts[1] !== amount) {
    throw new Error("Shield outputs must sum to the public deposit");
  }
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const outputNonces: readonly [bigint, bigint] = [
    generateShieldedRandomField(),
    generateShieldedRandomField(),
  ];
  const notes: readonly [ShieldedValueNotePayload, ShieldedValueNotePayload] = [
    { ownerCommitment: keys.ownerCommitment, amount: outputAmounts[0], nonce: outputNonces[0] },
    { ownerCommitment: keys.ownerCommitment, amount: outputAmounts[1], nonce: outputNonces[1] },
  ];
  const outputs = await Promise.all(
    notes.map((note) =>
      encryptOwnOutput(
        note,
        encodeShieldedValueNotePayload,
        (ciphertextHashField) => computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }),
        viewingKey,
        keys.hpkeIkm,
        chainId,
        poolAddress,
      ),
    ),
  ) as [PreparedOutput<ShieldedValueNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
  const data = emptyActionData(outputs);
  const publicSignals = publicSignalsFor(SHIELDED_POOL_ACTION.Shield, chainId, poolAddress, data, amount);
  const witness: ShieldedWitness = {
    publicSignals: decimal(publicSignals),
    ownerSecret: String(keys.ownerSecret),
    outputAmounts: decimal(outputAmounts),
    outputNonces: decimal(outputNonces),
  };
  return { amount, data, witness, outputs };
}

/**
 * Spend one locally recovered value note to create a private policy template.
 * The full input amount remains the owner's private change note.
 */
export async function prepareShieldedCreatePolicy(
  input: CommonPreparationInput & {
    wallet: LocalShieldedWalletSnapshot;
    inputCommitment: BigNumberish;
    rootIdentityCommitment: BigNumberish;
    rootVersionIndex: BigNumberish;
    amountPerPeriod: BigNumberish;
  },
): Promise<PreparedShieldedCreatePolicy> {
  const { chainId, poolAddress, keys } = context(input);
  if (
    input.wallet.invalidated ||
    input.wallet.chainId !== chainId ||
    input.wallet.poolAddress.toLowerCase() !== poolAddress.toLowerCase() ||
    input.wallet.walletOwnerCommitment !== keys.ownerCommitment
  ) {
    throw new Error("Shielded wallet does not match this identity, chain, or pool");
  }
  const inputCommitment = getBigInt(input.inputCommitment);
  const owned = input.wallet.ownedNotes.get(inputCommitment);
  if (!owned || owned.note.kind !== "value") {
    throw new Error("Input must be a locally recovered value note");
  }
  const inputNote = owned.note;
  if (inputNote.ownerCommitment !== keys.ownerCommitment) {
    throw new Error("Input value note belongs to another identity");
  }
  const inputCiphertextHash = computeShieldedCiphertextHashField(owned.ciphertext);
  if (
    inputCiphertextHash !== owned.ciphertextHashField ||
    computeShieldedValueNoteCommitment({ ...inputNote, ciphertextHashField: inputCiphertextHash }) !== inputCommitment
  ) {
    throw new Error("Input note does not match its public ciphertext and commitment");
  }
  const realNullifier = computeShieldedSpendNullifier({
    ownerSecret: keys.ownerSecret,
    noteCommitment: inputCommitment,
  });
  const dummyNullifier = computeShieldedDummyInputNullifier({
    ownerSecret: keys.ownerSecret,
    noteCommitment: inputCommitment,
  });
  if (
    input.wallet.spentNullifiers.has(realNullifier) ||
    input.wallet.spentNullifiers.has(dummyNullifier)
  ) {
    throw new Error("Input value note has already been spent");
  }
  const path = getRecoveredShieldedNoteProof(input.wallet, inputCommitment);
  const rootIdentityCommitment = getBigInt(input.rootIdentityCommitment);
  const rootVersionIndex = assertUint64(input.rootVersionIndex, "rootVersionIndex");
  const amountPerPeriod = assertUint128(input.amountPerPeriod, "amountPerPeriod");
  const policySalt = generateShieldedRandomField();
  const allocationKey = generateShieldedRandomField();
  const policyNonce = generateShieldedRandomField();
  const changeNonce = generateShieldedRandomField();
  const policyNote: ShieldedPolicyNotePayload = {
    rootIdentityCommitment,
    rootVersionIndex,
    amountPerPeriod,
    policySalt,
    allocationKey,
    nonce: policyNonce,
  };
  const policyCommitment = computeShieldedPolicyCommitment({
    rootIdentityCommitment,
    rootVersionIndex,
    amountPerPeriod,
    policySalt,
    allocationKeyCommitment: computeShieldedAllocationKeyCommitment(allocationKey),
  });
  const changeNote: ShieldedValueNotePayload = {
    ownerCommitment: keys.ownerCommitment,
    amount: inputNote.amount,
    nonce: changeNonce,
  };
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const outputs = await Promise.all([
    encryptOwnOutput(
      policyNote,
      encodeShieldedPolicyNotePayload,
      (ciphertextHashField) => computeShieldedPolicyNoteCommitment({
        policyCommitment,
        nonce: policyNonce,
        ciphertextHashField,
      }),
      viewingKey,
      keys.hpkeIkm,
      chainId,
      poolAddress,
    ),
    encryptOwnOutput(
      changeNote,
      encodeShieldedValueNotePayload,
      (ciphertextHashField) => computeShieldedValueNoteCommitment({ ...changeNote, ciphertextHashField }),
      viewingKey,
      keys.hpkeIkm,
      chainId,
      poolAddress,
    ),
  ]) as [PreparedOutput<ShieldedPolicyNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
  const data = {
    ...emptyActionData(outputs),
    inputShardIds: [path.shardId, path.shardId] as const,
    inputRoots: [path.root, path.root] as const,
    inputNullifiers: [realNullifier, dummyNullifier] as const,
  } satisfies ShieldedPoolActionData;
  const publicSignals = publicSignalsFor(SHIELDED_POOL_ACTION.CreatePolicy, chainId, poolAddress, data);
  const witness: ShieldedWitness = {
    publicSignals: decimal(publicSignals),
    ownerSecret: String(keys.ownerSecret),
    inputAmount: String(inputNote.amount),
    inputNonce: String(inputNote.nonce),
    inputCiphertextHash: String(inputCiphertextHash),
    noteDepth: path.proofDepth,
    noteIndex: String(path.proofIndex),
    noteSiblings: decimal(path.siblings),
    rootIdentityCommitment: String(rootIdentityCommitment),
    rootVersionIndex: String(rootVersionIndex),
    rate: String(amountPerPeriod),
    policySalt: String(policySalt),
    allocationKey: String(allocationKey),
    policyNonce: String(policyNonce),
    changeNonce: String(changeNonce),
  };
  return { data, witness, policyCommitment, outputs };
}
