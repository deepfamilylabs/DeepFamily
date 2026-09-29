import {
  SNARK_SCALAR_FIELD,
  wrapIdentityCommitmentAsPersonHash,
  type IdentityFields,
} from "@deepfamily/protocol-core";
import { getBigInt, toBeHex, type BigNumberish } from "ethers";
import { cryptoWorkerCall } from "../../../shared/workers/cryptoWorkerClient";

const RECEIVE_CODE = /^dfrecv1:(0x[0-9a-fA-F]{64}):(0x[0-9a-fA-F]{64})$/;

/** Share only with an intended sender. The salt opens the anonymous registry leaf. */
export function encodeShieldedReceiveCode(
  identityCommitment: BigNumberish,
  registrationSalt: BigNumberish,
): string {
  const identity = getBigInt(identityCommitment);
  const salt = getBigInt(registrationSalt);
  if (identity <= 0n || identity >= SNARK_SCALAR_FIELD) {
    throw new Error("Receive code identity commitment is invalid");
  }
  if (salt <= 0n || salt >= SNARK_SCALAR_FIELD) {
    throw new Error("Receive code registration salt is invalid");
  }
  return `dfrecv1:${toBeHex(identity, 32)}:${toBeHex(salt, 32)}`;
}

export function parseShieldedReceiveCode(value: string) {
  const match = RECEIVE_CODE.exec(value.trim());
  if (!match) throw new Error("Receive code format is invalid");
  const identityCommitment = BigInt(match[1]);
  const registrationSalt = BigInt(match[2]);
  if (
    identityCommitment <= 0n ||
    identityCommitment >= SNARK_SCALAR_FIELD ||
    registrationSalt <= 0n ||
    registrationSalt >= SNARK_SCALAR_FIELD
  ) {
    throw new Error("Receive code contains an invalid field element");
  }
  return {
    identityCommitment,
    registrationSalt,
    personHash: wrapIdentityCommitmentAsPersonHash(identityCommitment),
  };
}

export type ShieldedRecipientMaterialSource =
  | { kind: "receiveCode"; code: string }
  | { kind: "derivedRecipient"; material: ShieldedRecipientMaterial };

export type ShieldedRecipientMaterial = ReturnType<typeof parseShieldedReceiveCode>;

/** Derive only payment material in the worker; the child's spend secret stays there. */
export async function deriveShieldedRecipientMaterial(input: {
  identity: IdentityFields;
  rawPassphrase: string;
  /** Use the current key registry snapshot's chain and address. */
  chainId: bigint;
  registryAddress: string;
}): Promise<ShieldedRecipientMaterial> {
  const result = await cryptoWorkerCall("deriveShieldedRecipientMaterial", input, {
    timeoutMs: 240_000,
  });
  return resolveShieldedRecipientMaterial({
    kind: "derivedRecipient",
    material: {
      identityCommitment: BigInt(result.identityCommitment),
      registrationSalt: BigInt(result.registrationSalt),
      personHash: result.personHash,
    },
  });
}

/**
 * Normalize either private payment method without fetching a target identity.
 */
export function resolveShieldedRecipientMaterial(source: ShieldedRecipientMaterialSource) {
  if (source.kind === "receiveCode") return parseShieldedReceiveCode(source.code);
  const { material } = source;
  if (
    material.identityCommitment <= 0n ||
    material.identityCommitment >= SNARK_SCALAR_FIELD ||
    material.registrationSalt <= 0n ||
    material.registrationSalt >= SNARK_SCALAR_FIELD ||
    material.personHash.toLowerCase() !==
      wrapIdentityCommitmentAsPersonHash(material.identityCommitment).toLowerCase()
  ) {
    throw new Error("Derived recipient material is invalid");
  }
  return {
    identityCommitment: material.identityCommitment,
    registrationSalt: material.registrationSalt,
    personHash: material.personHash,
  };
}
