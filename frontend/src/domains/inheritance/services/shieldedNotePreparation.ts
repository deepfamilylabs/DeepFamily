import {
  SHIELDED_POOL_ACTION,
  buildShieldedHpkeAad,
  buildShieldedPoolPublicInputs,
  computeShieldedCiphertextHashField,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  type ShieldedScope,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, getBytes, type BigNumberish } from "ethers";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import type { ShieldedPoolActionData } from "./shieldedPoolFlows";

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
  outputs: readonly [
    PreparedOutput<ShieldedValueNotePayload>,
    PreparedOutput<ShieldedValueNotePayload>,
  ];
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
async function encryptOwnOutput<T extends ShieldedValueNotePayload>(
  note: T,
  encode: (value: T, scope: ShieldedScope) => Uint8Array,
  commitment: (ciphertextHashField: bigint) => bigint,
  viewingKey: Uint8Array,
  hpkeIkm: string,
  chainId: bigint,
  poolAddress: string,
): Promise<PreparedOutput<T>> {
  const payload = encode(note, { chainId, poolAddress });
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
    verifyShieldedNotePayload(
      { payload: opened, ciphertext, noteCommitment },
      { chainId, poolAddress },
    );
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
    fundMode: 0n,
    budgetKind: 0n,
    inputShardIds: [0n, 0n],
    inputRoots: [0n, 0n],
    inputNullifiers: [0n, 0n],
    periodNullifiers: [...ZERO_PERIOD_NULLIFIERS],
    outputCommitments: [outputs[0].commitment, outputs[1].commitment],
    outputCiphertexts: [outputs[0].ciphertext, outputs[1].ciphertext],
    relation0: 0n,
    relation1: 0n,
    asOf: 0n,
  };
}

/** The circuit's named public inputs for this action and data. */
function publicInputsFor(
  action: number,
  chainId: bigint,
  poolAddress: string,
  data: ShieldedPoolActionData,
  amount = 0n,
) {
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
    amount,
    relation0: data.relation0,
    relation1: data.relation1,
    asOf: data.asOf,
  }).witness;
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
    ? [
        assertUint128(input.outputAmounts[0], "outputAmounts[0]"),
        assertUint128(input.outputAmounts[1], "outputAmounts[1]"),
      ]
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
  const outputs = (await Promise.all(
    notes.map((note) =>
      encryptOwnOutput(
        note,
        encodeShieldedValueNotePayload,
        (ciphertextHashField) =>
          computeShieldedValueNoteCommitment(
            { ...note, ciphertextHashField },
            { chainId, poolAddress },
          ),
        viewingKey,
        keys.hpkeIkm,
        chainId,
        poolAddress,
      ),
    ),
  )) as [PreparedOutput<ShieldedValueNotePayload>, PreparedOutput<ShieldedValueNotePayload>];
  const data = emptyActionData(outputs);
  const publicInputs = publicInputsFor(
    SHIELDED_POOL_ACTION.Shield,
    chainId,
    poolAddress,
    data,
    amount,
  );
  const witness: ShieldedWitness = {
    ...publicInputs,
    ownerSecret: String(keys.ownerSecret),
    outputAmounts: decimal(outputAmounts),
    outputNonces: decimal(outputNonces),
  };
  return { amount, data, witness, outputs };
}
