import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicInputs,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedDummyInputNullifierForSlot,
  computeShieldedOwnerCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  planShieldedValueSpend,
} from "@deepfamily/protocol-core";
export { planShieldedValueSpend } from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import type { VerifiedShieldedRecipient } from "./shieldedReceiveCode";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";
import { getLocalShieldedNoteProof } from "./shieldedPoolChain";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const ZERO_PERIOD_NULLIFIERS = Array<bigint>(12).fill(0n);
type ValueNote = { ownerCommitment: bigint; amount: bigint; nonce: bigint };

export type ShieldedValueInput = {
  wallet: LocalShieldedWalletSnapshot;
  derivedSecretField?: BigNumberish;
  keyMaterial?: { ownerSecret: bigint; ownerCommitment: bigint; hpkeIkm: string };
  commitment: BigNumberish;
};

/** A recipient destination uses keys from a receive code that has already been verified. */
export type ShieldedValueDestination =
  | { kind: "inputOwner"; inputIndex: number; amount: BigNumberish }
  | { kind: "recipient"; recipient: VerifiedShieldedRecipient; amount: BigNumberish };

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
  path: ReturnType<typeof getLocalShieldedNoteProof>;
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
  const keys =
    input.keyMaterial ??
    (input.derivedSecretField !== undefined
      ? deriveShieldedHeirKeyMaterial(input.derivedSecretField)
      : undefined);
  if (!keys) throw new Error("VALUE spending needs an unlocked owner key");
  if (computeShieldedOwnerCommitment(keys.ownerSecret) !== keys.ownerCommitment) {
    throw new Error("VALUE owner key does not match its commitment");
  }
  const wallet = input.wallet;
  if (
    wallet.invalidated ||
    wallet.chainId !== ctx.chainId ||
    wallet.poolAddress.toLowerCase() !== ctx.poolAddress.toLowerCase()
  )
    throw new Error("Value wallet does not match this chain or pool");
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
    throw new Error("Input value note belongs to another owner");
    if (note.amount <= 0n || note.amount > MAX_UINT128)
      throw new Error("VALUE input amount must be positive uint128");
  }
  const ciphertextHashField = computeShieldedCiphertextHashField(owned.ciphertext);
  if (
    owned.ciphertextHashField !== ciphertextHashField ||
    computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }, ctx) !== commitment
  )
    throw new Error("Input note does not match its public ciphertext and commitment");

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
    const reopened = verifyShieldedNotePayload(
      {
        payload,
        ciphertext: owned.ciphertext,
        noteCommitment: commitment,
      },
      ctx,
    ).note;
    if (
      reopened.kind !== "value" ||
      reopened.ownerCommitment !== note.ownerCommitment ||
      reopened.amount !== note.amount ||
      reopened.nonce !== note.nonce
    )
      throw new Error("Cached input plaintext does not match its ciphertext");
  } finally {
    payload?.fill(0);
    hpkeIkm.fill(0);
  }

  const nullifier = computeShieldedSpendNullifier(
    {
      ownerSecret: keys.ownerSecret,
      noteCommitment: commitment,
    },
    ctx,
  );
  if (wallet.spentNullifiers.has(nullifier))
    throw new Error("Input value note has already been spent");
  const path = getLocalShieldedNoteProof(wallet, commitment);
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
  const payload = encodeShieldedValueNotePayload(note, ctx);
  let reopened: Uint8Array | undefined;
  try {
    const ciphertext = await encryptShieldedNote({
      recipientPublicKey: viewingKey,
      payload,
      chainId: ctx.chainId,
      poolAddress: ctx.poolAddress,
    });
    const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
    const commitment = computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }, ctx);
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
      const recovered = verifyShieldedNotePayload(
        {
          payload: reopened,
          ciphertext,
          noteCommitment: commitment,
        },
        ctx,
      ).note;
      if (
        recovered.kind !== "value" ||
        recovered.ownerCommitment !== note.ownerCommitment ||
        recovered.amount !== note.amount ||
        recovered.nonce !== note.nonce
      )
        throw new Error("Self output did not decrypt to its intended value note");
    }
    return { note, commitment, ciphertext, ciphertextHashField };
  } finally {
    payload.fill(0);
    reopened?.fill(0);
  }
}

function actionData(
  paths: readonly OpenedValueInput[],
  nullifiers: readonly bigint[],
  outputs: readonly [PreparedShieldedValueOutput, PreparedShieldedValueOutput],
): ShieldedPoolActionData {
  return {
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: paths.map((path) => path.path.shardId),
    inputRoots: paths.map((path) => path.path.root),
    inputNullifiers: nullifiers,
    periodNullifiers: [...ZERO_PERIOD_NULLIFIERS],
    outputCommitments: [outputs[0].commitment, outputs[1].commitment],
    outputCiphertexts: [outputs[0].ciphertext, outputs[1].ciphertext],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
  };
}

/** The circuit's named public inputs for this action and data. */
function publicInputs(
  action: number,
  ctx: Context,
  data: ShieldedPoolActionData,
  amount = 0n,
  recipient?: string,
) {
  return buildShieldedPoolPublicInputs({
    action,
    chainId: ctx.chainId,
    poolAddress: ctx.poolAddress,
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: [...data.inputShardIds],
    inputRoots: [...data.inputRoots],
    inputNullifiers: [...data.inputNullifiers],
    periodNullifiers: [...data.periodNullifiers],
    outputCommitments: [...data.outputCommitments],
    outputCiphertexts: [...data.outputCiphertexts],
    relation0: data.relation0,
    relation1: data.relation1,
    asOf: data.asOf,
    amount,
    recipient,
  }).witness;
}

/**
 * Spend one to eight locally recovered value notes of one owner into two encrypted notes.
 * Recipient identity is absent from the public proof and event. The recipient's
 * keys come from a receive code that was verified before preparation.
 */
export async function prepareShieldedPrivateTransfer(input: {
  chainId: BigNumberish;
  poolAddress: string;
  inputs: readonly ShieldedValueInput[];
  destinations: readonly [ShieldedValueDestination, ShieldedValueDestination];
}): Promise<PreparedShieldedPrivateTransfer> {
  const ctx = context(input.chainId, input.poolAddress);
  if (input.inputs.length < 1 || input.inputs.length > 8) {
    throw new Error("Private transfer needs one to eight input notes");
  }
  if (
    new Set(input.inputs.map((note) => String(getBigInt(note.commitment)))).size !==
    input.inputs.length
  ) {
    throw new Error("Private transfer needs distinct input notes");
  }
  const opened = await Promise.all(input.inputs.map((note) => openValueInput(note, ctx)));
  const first = opened[0];
  const second = opened[1];
  if (!first) throw new Error("Private transfer needs a value note");
  // Different wallet scans must be anchored to the same public chain state.
  if (
    input.inputs.some(
      (note) =>
        input.inputs[0].wallet.toBlock !== note.wallet.toBlock ||
        input.inputs[0].wallet.blockHash !== note.wallet.blockHash,
    )
  )
    throw new Error("Private transfer input wallets must share one public snapshot block");
  if (opened.some((note) => note.ownerCommitment !== first.ownerCommitment)) {
    throw new Error("Private transfer inputs must share one owner");
  }
  const total = opened.reduce((sum, note) => sum + note.note.amount, 0n);
  if (total === 0n) throw new Error("Private transfer requires positive input value");
  const outputAmounts = input.destinations.map((destination, index) =>
    uint128(destination.amount, `destinations[${index}].amount`),
  ) as [bigint, bigint];
  if (outputAmounts[0] + outputAmounts[1] !== total) {
    throw new Error("Private transfer outputs must equal the input amounts");
  }
  const destinationKeys = (await Promise.all(
    input.destinations.map(async (destination) => {
      if (destination.kind === "inputOwner") {
        const source = opened[destination.inputIndex];
        if (!source) throw new Error("Invalid private transfer input owner index");
        return {
          ownerCommitment: source.ownerCommitment,
          viewingKey: await deriveShieldedViewPublicKey(source.hpkeIkm),
          selfHpkeIkm: source.hpkeIkm,
        };
      }
      return {
        ownerCommitment: destination.recipient.ownerCommitment,
        viewingKey: getBytes(destination.recipient.viewingKey),
      };
    }),
  )) as [
    { ownerCommitment: bigint; viewingKey: Uint8Array; selfHpkeIkm?: string },
    { ownerCommitment: bigint; viewingKey: Uint8Array; selfHpkeIkm?: string },
  ];
  const outputs = (await Promise.all(
    destinationKeys.map((destination, index) => {
      const note: ValueNote = {
        ownerCommitment: destination.ownerCommitment,
        amount: outputAmounts[index],
        nonce: generateShieldedRandomField(),
      };
      return encryptValueOutput(note, destination.viewingKey, ctx, destination.selfHpkeIkm);
    }),
  )) as [PreparedShieldedValueOutput, PreparedShieldedValueOutput];
  const secondNullifier =
    second?.nullifier ??
    computeShieldedDummyInputNullifier(
      {
        ownerSecret: first.ownerSecret,
        noteCommitment: getBigInt(input.inputs[0].commitment),
      },
      ctx,
    );
  if (!second && input.inputs[0].wallet.spentNullifiers.has(secondNullifier)) {
    throw new Error("Input value note has already been spent");
  }
  const capacity = opened.length > 2 ? 8 : 2;
  const paths = Array.from({ length: capacity }, (_, index) => opened[index] ?? first);
  const nullifiers = Array.from(
    { length: capacity },
    (_, index) =>
      opened[index]?.nullifier ??
      computeShieldedDummyInputNullifierForSlot(
        first.ownerSecret,
        getBigInt(input.inputs[0].commitment),
        index,
        ctx,
      ),
  );
  if (nullifiers.some((nullifier) => input.inputs[0].wallet.spentNullifiers.has(nullifier))) {
    throw new Error("Input value note has already been spent");
  }
  const data = actionData(paths, nullifiers, outputs);
  const zeroSiblings = Array<bigint>(32).fill(0n);
  const witness: ShieldedWitness = {
    ...publicInputs(SHIELDED_POOL_ACTION.PrivateTransfer, ctx, data),
    ...(capacity === 8
      ? {
          inputEnabled: Array.from({ length: capacity }, (_, index) =>
            index < opened.length ? "1" : "0",
          ),
        }
      : { hasSecondInput: second ? "1" : "0" }),
    inputOwnerSecrets: Array.from({ length: capacity }, (_, index) =>
      String(opened[index]?.ownerSecret ?? 0n),
    ),
    inputAmounts: Array.from({ length: capacity }, (_, index) =>
      String(opened[index]?.note.amount ?? 0n),
    ),
    inputNonces: Array.from({ length: capacity }, (_, index) =>
      String(opened[index]?.note.nonce ?? 0n),
    ),
    inputCiphertextHashes: Array.from({ length: capacity }, (_, index) =>
      String(opened[index]?.ciphertextHashField ?? 0n),
    ),
    inputDepths: Array.from({ length: capacity }, (_, index) =>
      String(opened[index]?.path.proofDepth ?? 0),
    ),
    inputIndices: Array.from({ length: capacity }, (_, index) =>
      String(opened[index]?.path.proofIndex ?? 0n),
    ),
    inputSiblings: Array.from({ length: capacity }, (_, index) =>
      decimal(opened[index]?.path.siblings ?? zeroSiblings),
    ),
    outputOwnerCommitments: decimal(
      destinationKeys.map((destination) => destination.ownerCommitment),
    ),
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
  input?: ShieldedValueInput;
  inputs?: readonly ShieldedValueInput[];
  amount: BigNumberish;
  recipient: string;
}): Promise<PreparedShieldedUnshield> {
  const ctx = context(input.chainId, input.poolAddress);
  const amount = uint128(input.amount, "amount");
  if (amount === 0n) throw new Error("Unshield amount must be positive");
  const recipient = getAddress(input.recipient);
  if (BigInt(recipient) === 0n) throw new Error("Unshield recipient must be nonzero");
  const sources = input.inputs ?? (input.input ? [input.input] : []);
  if (sources.length < 1 || sources.length > 8)
    throw new Error("Unshield needs one to eight input notes");
  if (
    new Set(sources.map((source) => String(getBigInt(source.commitment)))).size !== sources.length
  ) {
    throw new Error("Unshield needs distinct input notes");
  }
  const allOpened = await Promise.all(sources.map((source) => openValueInput(source, ctx)));
  const opened = allOpened[0];
  if (
    allOpened.some((note) => note.ownerCommitment !== opened.ownerCommitment) ||
    sources.some(
      (source) =>
        source.wallet.toBlock !== sources[0].wallet.toBlock ||
        source.wallet.blockHash !== sources[0].wallet.blockHash,
    )
  ) {
    throw new Error("Unshield inputs must share one owner and public snapshot block");
  }
  const total = allOpened.reduce((sum, note) => sum + note.note.amount, 0n);
  if (amount > total) throw new Error("Unshield amount exceeds the input notes");
  if (total - amount > MAX_UINT128) throw new Error("Unshield change must fit in uint128");
  const dummyNullifier = computeShieldedDummyInputNullifier(
    {
      ownerSecret: opened.ownerSecret,
      noteCommitment: getBigInt(sources[0].commitment),
    },
    ctx,
  );
  if (sources[0].wallet.spentNullifiers.has(dummyNullifier)) {
    throw new Error("Input value note has already been spent");
  }
  const viewingKey = await deriveShieldedViewPublicKey(opened.hpkeIkm);
  const notes: readonly [ValueNote, ValueNote] = [
    {
      ownerCommitment: opened.ownerCommitment,
      amount: total - amount,
      nonce: generateShieldedRandomField(),
    },
    { ownerCommitment: opened.ownerCommitment, amount: 0n, nonce: generateShieldedRandomField() },
  ];
  const outputs = (await Promise.all(
    notes.map((note) => encryptValueOutput(note, viewingKey, ctx, opened.hpkeIkm)),
  )) as [PreparedShieldedValueOutput, PreparedShieldedValueOutput];
  const capacity = sources.length === 1 ? 2 : 8;
  const nullifiers = Array.from(
    { length: capacity },
    (_, index) =>
      allOpened[index]?.nullifier ??
      computeShieldedDummyInputNullifierForSlot(
        opened.ownerSecret,
        getBigInt(sources[0].commitment),
        index,
        ctx,
      ),
  );
  if (nullifiers.some((nullifier) => sources[0].wallet.spentNullifiers.has(nullifier)))
    throw new Error("Input value note has already been spent");
  const data = actionData(
    Array.from({ length: capacity }, (_, index) => allOpened[index] ?? opened),
    nullifiers,
    outputs,
  );
  const witness: ShieldedWitness = {
    ...publicInputs(SHIELDED_POOL_ACTION.Unshield, ctx, data, amount, recipient),
    ...(capacity === 8
      ? {
          inputEnabled: Array.from({ length: 8 }, (_, index) =>
            index < allOpened.length ? "1" : "0",
          ),
          inputOwnerSecrets: Array.from({ length: 8 }, (_, index) =>
            String(allOpened[index]?.ownerSecret ?? 0n),
          ),
          inputAmounts: Array.from({ length: 8 }, (_, index) =>
            String(allOpened[index]?.note.amount ?? 0n),
          ),
          inputNonces: Array.from({ length: 8 }, (_, index) =>
            String(allOpened[index]?.note.nonce ?? 0n),
          ),
          inputCiphertextHashes: Array.from({ length: 8 }, (_, index) =>
            String(allOpened[index]?.ciphertextHashField ?? 0n),
          ),
          inputDepths: Array.from({ length: 8 }, (_, index) =>
            String(allOpened[index]?.path.proofDepth ?? 0),
          ),
          inputIndices: Array.from({ length: 8 }, (_, index) =>
            String(allOpened[index]?.path.proofIndex ?? 0n),
          ),
          inputSiblings: Array.from({ length: 8 }, (_, index) =>
            decimal(allOpened[index]?.path.siblings ?? Array<bigint>(32).fill(0n)),
          ),
        }
      : {
          ownerSecret: String(opened.ownerSecret),
          inputAmount: String(opened.note.amount),
          inputNonce: String(opened.note.nonce),
          inputCiphertextHash: String(opened.ciphertextHashField),
          noteDepth: opened.path.proofDepth,
          noteIndex: String(opened.path.proofIndex),
          noteSiblings: decimal(opened.path.siblings),
        }),
    changeAmount: String(notes[0].amount),
    changeNonce: String(notes[0].nonce),
    dummyNonce: String(notes[1].nonce),
  };
  return { amount, recipient, data, witness, outputs };
}

/** Prepare only the first merge from a complete preview; re-scan and confirm after its receipt. */
export async function prepareShieldedValueConsolidation(input: {
  chainId: BigNumberish;
  poolAddress: string;
  wallet: LocalShieldedWalletSnapshot;
  derivedSecretField?: BigNumberish;
  keyMaterial?: ShieldedValueInput["keyMaterial"];
  candidateCommitments?: readonly BigNumberish[];
  maxInputs?: 1 | 2 | 8;
  amount: BigNumberish;
}): Promise<PreparedShieldedPrivateTransfer | undefined> {
  const amount = uint128(input.amount, "amount");
  if (amount === 0n) throw new Error("Consolidation target must be positive");
  const keys =
    input.keyMaterial ??
    (input.derivedSecretField !== undefined
      ? deriveShieldedHeirKeyMaterial(input.derivedSecretField)
      : undefined);
  if (!keys) throw new Error("Consolidation needs an unlocked owner key");
  const ctx = context(input.chainId, input.poolAddress);
  const notes = [...input.wallet.ownedNotes.values()].filter(
    (owned) =>
      owned.note.kind === "value" &&
      owned.note.ownerCommitment === keys.ownerCommitment &&
      owned.note.amount > 0n &&
      !input.wallet.spentNullifiers.has(
        computeShieldedSpendNullifier(
          { ownerSecret: keys.ownerSecret, noteCommitment: owned.commitment },
          ctx,
        ),
      ),
  );
  const plan = planShieldedValueSpend({
    notes: notes.map((owned) => ({
      commitment: owned.commitment,
      amount: (owned.note as ValueNote).amount,
    })),
    candidateCommitments: input.candidateCommitments?.map((value) => String(getBigInt(value))),
    amount,
    maxInputs: input.maxInputs ?? 1,
  });
  const step = plan.steps[0];
  if (step.kind === "spend") return undefined;
  return prepareShieldedPrivateTransfer({
    chainId: input.chainId,
    poolAddress: input.poolAddress,
    inputs: step.inputCommitments.map((commitment) => ({
      wallet: input.wallet,
      derivedSecretField: input.derivedSecretField,
      keyMaterial: input.keyMaterial,
      commitment,
    })),
    destinations: [
      { kind: "inputOwner", inputIndex: 0, amount: step.outputAmounts[0] },
      { kind: "inputOwner", inputIndex: 0, amount: step.outputAmounts[1] },
    ],
  });
}
