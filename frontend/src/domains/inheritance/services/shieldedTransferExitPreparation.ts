import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicSignals,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedOwnerCommitment,
  computeShieldedRegistrationLeaf,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  splitShieldedViewPublicKey,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import type { KeyRegistrySnapshot } from "./shieldedKeyRegistryChain";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import { getRecoveredShieldedNoteProof, type LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const ZERO_PERIOD_NULLIFIERS = Array<bigint>(12).fill(0n);
type ValueNote = { ownerCommitment: bigint; amount: bigint; nonce: bigint };

export type ShieldedValueInput = {
  wallet: LocalShieldedWalletSnapshot;
  derivedSecretField: BigNumberish;
  commitment: BigNumberish;
};

/** A registered destination is resolved from a locally replayed public key registry. */
export type ShieldedValueDestination =
  | { kind: "inputOwner"; inputIndex: 0 | 1; amount: BigNumberish }
  | { kind: "registered"; personHash: string; amount: BigNumberish };

export type PreparedShieldedValueOutput = {
  /** This plaintext and the proof witness stay on the user's device. */
  note: ValueNote;
  commitment: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
};

export type PreparedShieldedPrivateTransfer = {
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  outputs: readonly [PreparedShieldedValueOutput, PreparedShieldedValueOutput];
};

export type PreparedShieldedUnshield = PreparedShieldedPrivateTransfer & {
  amount: bigint;
  recipient: string;
};

type Context = { chainId: bigint; poolAddress: string };
type OpenedValueInput = {
  note: ValueNote;
  ownerSecret: bigint;
  ownerCommitment: bigint;
  hpkeIkm: string;
  ciphertextHashField: bigint;
  nullifier: bigint;
  path: ReturnType<typeof getRecoveredShieldedNoteProof>;
};

function uint128(value: BigNumberish, label: string): bigint {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed > MAX_UINT128) throw new Error(`${label} must fit in uint128`);
  return parsed;
}

function context(chainIdInput: BigNumberish, poolAddressInput: string): Context {
  const chainId = getBigInt(chainIdInput);
  if (chainId < 0n || chainId > MAX_UINT64) throw new Error("chainId must fit in uint64");
  return { chainId, poolAddress: getAddress(poolAddressInput) };
}

function decimal(values: readonly bigint[]): string[] {
  return values.map(String);
}

async function openValueInput(input: ShieldedValueInput, ctx: Context): Promise<OpenedValueInput> {
  const keys = deriveShieldedHeirKeyMaterial(input.derivedSecretField);
  const wallet = input.wallet;
  if (
    wallet.invalidated || wallet.chainId !== ctx.chainId ||
    wallet.poolAddress.toLowerCase() !== ctx.poolAddress.toLowerCase() ||
    wallet.walletOwnerCommitment !== keys.ownerCommitment
  ) throw new Error("Value wallet does not match this identity, chain, or pool");
  const commitment = getBigInt(input.commitment);
  const owned = wallet.ownedNotes.get(commitment);
  if (!owned || owned.note.kind !== "value") {
    throw new Error("Input must be a locally recovered value note");
  }
  const note: ValueNote = {
    ownerCommitment: getBigInt(owned.note.ownerCommitment),
    amount: getBigInt(owned.note.amount),
    nonce: getBigInt(owned.note.nonce),
  };
  if (note.ownerCommitment !== computeShieldedOwnerCommitment(keys.ownerSecret)) {
    throw new Error("Input value note belongs to another identity");
  }
  const ciphertextHashField = computeShieldedCiphertextHashField(owned.ciphertext);
  if (
    owned.ciphertextHashField !== ciphertextHashField ||
    computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }) !== commitment
  ) throw new Error("Input note does not match its public ciphertext and commitment");

  // Reopen the actual event ciphertext, rather than trusting mutable cached plaintext.
  const hpkeIkm = getBytes(keys.hpkeIkm);
  let payload: Uint8Array | undefined;
  try {
    payload = await decryptShieldedNote({
      hpkeIkm,
      ciphertext: owned.ciphertext,
      chainId: ctx.chainId,
      poolAddress: ctx.poolAddress,
    });
    const reopened = verifyShieldedNotePayload({
      payload,
      ciphertext: owned.ciphertext,
      noteCommitment: commitment,
    }).note;
    if (
      reopened.kind !== "value" || reopened.ownerCommitment !== note.ownerCommitment ||
      reopened.amount !== note.amount || reopened.nonce !== note.nonce
    ) throw new Error("Cached input plaintext does not match its ciphertext");
  } finally {
    payload?.fill(0);
    hpkeIkm.fill(0);
  }

  const nullifier = computeShieldedSpendNullifier({
    ownerSecret: keys.ownerSecret,
    noteCommitment: commitment,
  });
  if (wallet.spentNullifiers.has(nullifier)) throw new Error("Input value note has already been spent");
  const path = getRecoveredShieldedNoteProof(wallet, commitment);
  return {
    note,
    ownerSecret: keys.ownerSecret,
    ownerCommitment: keys.ownerCommitment,
    hpkeIkm: keys.hpkeIkm,
    ciphertextHashField,
    nullifier,
    path,
  };
}

async function encryptValueOutput(
  note: ValueNote,
  viewingKey: Uint8Array,
  ctx: Context,
  selfHpkeIkm?: string,
): Promise<PreparedShieldedValueOutput> {
  const payload = encodeShieldedValueNotePayload(note);
  let reopened: Uint8Array | undefined;
  try {
    const ciphertext = await encryptShieldedNote({
      recipientPublicKey: viewingKey,
      payload,
      chainId: ctx.chainId,
      poolAddress: ctx.poolAddress,
    });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    const commitment = computeShieldedValueNoteCommitment({ ...note, ciphertextHashField });
    if (selfHpkeIkm !== undefined) {
      const ikm = getBytes(selfHpkeIkm);
      try {
        reopened = await decryptShieldedNote({
          hpkeIkm: ikm,
          ciphertext,
          chainId: ctx.chainId,
          poolAddress: ctx.poolAddress,
        });
      } finally {
        ikm.fill(0);
      }
      const recovered = verifyShieldedNotePayload({
        payload: reopened,
        ciphertext,
        noteCommitment: commitment,
      }).note;
      if (
        recovered.kind !== "value" || recovered.ownerCommitment !== note.ownerCommitment ||
        recovered.amount !== note.amount || recovered.nonce !== note.nonce
      ) throw new Error("Self output did not decrypt to its intended value note");
    }
    return { note, commitment, ciphertext, ciphertextHashField };
  } finally {
    payload.fill(0);
    reopened?.fill(0);
  }
}

function registeredRecipient(snapshot: KeyRegistrySnapshot, personHash: string, ctx: Context) {
  if (snapshot.invalidated || snapshot.chainId !== ctx.chainId) {
    throw new Error("Key registry snapshot belongs to another chain or is invalid");
  }
  const key = snapshot.keys.get(personHash.toLowerCase());
  if (!key) throw new Error("Recipient has no registered viewing key");
  if (
    key.personHash.toLowerCase() !== personHash.toLowerCase() ||
    wrapIdentityCommitmentAsPersonHash(key.identityCommitment).toLowerCase() !== key.personHash.toLowerCase()
  ) throw new Error("Recipient identity does not match the local registry key");
  const tree = snapshot.shards.get(key.shardId);
  if (!tree) throw new Error("Recipient key shard is missing");
  const proof = tree.generateProof(key.leafIndex);
  const { viewKeyHi, viewKeyLo } = splitShieldedViewPublicKey(getBytes(key.viewingKey));
  if (
    proof.leaf !== key.leaf ||
    proof.leaf !== computeShieldedRegistrationLeaf({
      identityCommitment: key.identityCommitment,
      ownerCommitment: key.ownerCommitment,
      viewKeyHi,
      viewKeyLo,
    })
  ) throw new Error("Recipient viewing key does not match the local registry leaf");
  return { ownerCommitment: key.ownerCommitment, viewingKey: getBytes(key.viewingKey) };
}

function actionData(
  paths: readonly [OpenedValueInput, OpenedValueInput],
  nullifiers: readonly [bigint, bigint],
  outputs: readonly [PreparedShieldedValueOutput, PreparedShieldedValueOutput],
): ShieldedPoolActionData {
  return {
    inputShardIds: [paths[0].path.shardId, paths[1].path.shardId],
    inputRoots: [paths[0].path.root, paths[1].path.root],
    inputNullifiers: nullifiers,
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

function signals(
  action: number,
  ctx: Context,
  data: ShieldedPoolActionData,
  amount = 0n,
  recipient?: string,
) {
  return decimal(buildShieldedPoolPublicSignals({
    action,
    chainId: ctx.chainId,
    poolAddress: ctx.poolAddress,
    inputShardIds: [...data.inputShardIds],
    inputRoots: [...data.inputRoots],
    inputNullifiers: [...data.inputNullifiers],
    periodNullifiers: [...data.periodNullifiers],
    outputCommitments: [...data.outputCommitments],
    outputCiphertexts: [...data.outputCiphertexts],
    relation0: data.relation0,
    relation1: data.relation1,
    asOf: data.asOf,
    registryRoot: data.registryRoot,
    registryShardId: data.registryShardId,
    amount,
    recipient,
  }));
}

/**
 * Spend one or two locally recovered value notes into two encrypted value notes.
 * Recipient identity is absent from the public proof and event. A registered
 * recipient's key is read from the unfiltered local key-registry snapshot.
 */
export async function prepareShieldedPrivateTransfer(input: {
  chainId: BigNumberish;
  poolAddress: string;
  inputs: readonly [ShieldedValueInput] | readonly [ShieldedValueInput, ShieldedValueInput];
  destinations: readonly [ShieldedValueDestination, ShieldedValueDestination];
  keyRegistry?: KeyRegistrySnapshot;
}): Promise<PreparedShieldedPrivateTransfer> {
  const ctx = context(input.chainId, input.poolAddress);
  if (input.inputs.length !== 1 && input.inputs.length !== 2) {
    throw new Error("Private transfer needs one or two input notes");
  }
  if (input.inputs.length === 2 &&
      getBigInt(input.inputs[0].commitment) === getBigInt(input.inputs[1].commitment)) {
    throw new Error("Private transfer needs two distinct input notes");
  }
  const opened = await Promise.all(input.inputs.map((note) => openValueInput(note, ctx)));
  const first = opened[0];
  const second = opened[1];
  const secondInput = input.inputs[1];
  if (!first) throw new Error("Private transfer needs a value note");
  // Different wallet scans must be anchored to the same public chain state.
  if (secondInput && (
    input.inputs[0].wallet.toBlock !== secondInput.wallet.toBlock ||
    input.inputs[0].wallet.blockHash !== secondInput.wallet.blockHash
  )) throw new Error("Private transfer input wallets must share one public snapshot block");
  const total = first.note.amount + (second?.note.amount ?? 0n);
  if (total === 0n) throw new Error("Private transfer requires positive input value");
  const outputAmounts = input.destinations.map((destination, index) =>
    uint128(destination.amount, `destinations[${index}].amount`)) as [bigint, bigint];
  if (outputAmounts[0] + outputAmounts[1] !== total) {
    throw new Error("Private transfer outputs must equal the two input amounts");
  }
  const destinationKeys = await Promise.all(input.destinations.map(async (destination) => {
    if (destination.kind === "inputOwner") {
      const source = opened[destination.inputIndex];
      if (!source) throw new Error("Invalid private transfer input owner index");
      return {
        ownerCommitment: source.ownerCommitment,
        viewingKey: await deriveShieldedViewPublicKey(source.hpkeIkm),
        selfHpkeIkm: source.hpkeIkm,
      };
    }
    if (!input.keyRegistry) throw new Error("Registered destination needs a local key registry snapshot");
    return registeredRecipient(input.keyRegistry, destination.personHash, ctx);
  })) as [
    { ownerCommitment: bigint; viewingKey: Uint8Array; selfHpkeIkm?: string },
    { ownerCommitment: bigint; viewingKey: Uint8Array; selfHpkeIkm?: string },
  ];
  const outputs = await Promise.all(destinationKeys.map((destination, index) => {
    const note: ValueNote = {
      ownerCommitment: destination.ownerCommitment,
      amount: outputAmounts[index],
      nonce: generateShieldedRandomField(),
    };
    return encryptValueOutput(note, destination.viewingKey, ctx, destination.selfHpkeIkm);
  })) as [PreparedShieldedValueOutput, PreparedShieldedValueOutput];
  const secondNullifier = second?.nullifier ?? computeShieldedDummyInputNullifier({
    ownerSecret: first.ownerSecret,
    noteCommitment: getBigInt(input.inputs[0].commitment),
  });
  if (!second && input.inputs[0].wallet.spentNullifiers.has(secondNullifier)) {
    throw new Error("Input value note has already been spent");
  }
  const data = actionData(
    [first, second ?? first],
    [first.nullifier, secondNullifier],
    outputs,
  );
  const zeroSiblings = Array<bigint>(32).fill(0n);
  const witness: ShieldedWitness = {
    publicSignals: signals(SHIELDED_POOL_ACTION.PrivateTransfer, ctx, data),
    hasSecondInput: second ? "1" : "0",
    inputOwnerSecrets: decimal([first.ownerSecret, second?.ownerSecret ?? 0n]),
    inputAmounts: decimal([first.note.amount, second?.note.amount ?? 0n]),
    inputNonces: decimal([first.note.nonce, second?.note.nonce ?? 0n]),
    inputCiphertextHashes: decimal([first.ciphertextHashField, second?.ciphertextHashField ?? 0n]),
    inputDepths: [String(first.path.proofDepth), String(second?.path.proofDepth ?? 0)],
    inputIndices: decimal([first.path.proofIndex, second?.path.proofIndex ?? 0n]),
    inputSiblings: [decimal(first.path.siblings), decimal(second?.path.siblings ?? zeroSiblings)],
    outputOwnerCommitments: decimal(destinationKeys.map((destination) => destination.ownerCommitment)),
    outputAmounts: decimal(outputAmounts),
    outputNonces: decimal(outputs.map((output) => output.note.nonce)),
  };
  return { data, witness, outputs };
}

/**
 * Withdraw public DEEP from one private value note. The recipient and amount
 * are deliberately public; change and the zero-value dummy remain encrypted.
 */
export async function prepareShieldedUnshield(input: {
  chainId: BigNumberish;
  poolAddress: string;
  input: ShieldedValueInput;
  amount: BigNumberish;
  recipient: string;
}): Promise<PreparedShieldedUnshield> {
  const ctx = context(input.chainId, input.poolAddress);
  const amount = uint128(input.amount, "amount");
  if (amount === 0n) throw new Error("Unshield amount must be positive");
  const recipient = getAddress(input.recipient);
  if (BigInt(recipient) === 0n) throw new Error("Unshield recipient must be nonzero");
  const opened = await openValueInput(input.input, ctx);
  if (amount > opened.note.amount) throw new Error("Unshield amount exceeds the input note");
  const dummyNullifier = computeShieldedDummyInputNullifier({
    ownerSecret: opened.ownerSecret,
    noteCommitment: getBigInt(input.input.commitment),
  });
  if (input.input.wallet.spentNullifiers.has(dummyNullifier)) {
    throw new Error("Input value note has already been spent");
  }
  const viewingKey = await deriveShieldedViewPublicKey(opened.hpkeIkm);
  const notes: readonly [ValueNote, ValueNote] = [
    { ownerCommitment: opened.ownerCommitment, amount: opened.note.amount - amount, nonce: generateShieldedRandomField() },
    { ownerCommitment: opened.ownerCommitment, amount: 0n, nonce: generateShieldedRandomField() },
  ];
  const outputs = await Promise.all(notes.map((note) =>
    encryptValueOutput(note, viewingKey, ctx, opened.hpkeIkm),
  )) as [PreparedShieldedValueOutput, PreparedShieldedValueOutput];
  const data = actionData([opened, opened], [opened.nullifier, dummyNullifier], outputs);
  const witness: ShieldedWitness = {
    publicSignals: signals(SHIELDED_POOL_ACTION.Unshield, ctx, data, amount, recipient),
    ownerSecret: String(opened.ownerSecret),
    inputAmount: String(opened.note.amount),
    inputNonce: String(opened.note.nonce),
    inputCiphertextHash: String(opened.ciphertextHashField),
    noteDepth: opened.path.proofDepth,
    noteIndex: String(opened.path.proofIndex),
    noteSiblings: decimal(opened.path.siblings),
    changeAmount: String(notes[0].amount),
    changeNonce: String(notes[0].nonce),
    dummyNonce: String(notes[1].nonce),
  };
  return { amount, recipient, data, witness, outputs };
}
