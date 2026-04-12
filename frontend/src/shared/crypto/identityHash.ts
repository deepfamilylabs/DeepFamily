import { ethers } from "ethers";
import {
  computePersonHashFromData,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_CRYPTO_SUITE_VERSION,
  DEFAULT_HASH_ALGO_ID,
} from "../zk/zk";
import { canonicalizeFullName, packBirthGenderField } from "./identityCommitment";
import { normalizePassphraseForHash } from "./passphraseStrength";
import {
  bytesToHex,
  deriveIdentitySecret,
  generateRandomSalt,
  hexToBytes,
  mapBytesToSnarkField,
  type DerivedSecretBundle,
} from "./secretDerivation";

export type IdentitySaltMode = "deterministic" | "random";

export type IdentityHashInput = {
  fullName: string;
  passphrase: string;
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
  identityMode?: IdentitySaltMode;
  identitySaltHex?: string | null;
};

export type IdentityHashComputation = {
  identityMode: IdentitySaltMode;
  canonicalFullName: string;
  personHash: string;
  identityCommitment: bigint;
  nameField: bigint;
  suiteCommitment: bigint;
  packedBirthGenderField: bigint;
  derivedSecretField: bigint;
  derivedSecretBundle: DerivedSecretBundle | null;
  identitySaltHex: string | null;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

const IDENTITY_SALT_DOMAIN = "deepfamily:identity-kdf-salt:v1";
const IDENTITY_SALT_BYTES = 16;

export function normalizeIdentitySaltHex(value: string): string {
  const normalized = (value ?? "").trim().replace(/^0x/i, "").toLowerCase();
  if (!normalized) {
    throw new Error("Identity recovery salt is required");
  }
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length !== IDENTITY_SALT_BYTES * 2) {
    throw new Error("Identity recovery salt must be 16-byte hex");
  }
  return normalized;
}

export function generateRandomIdentitySaltHex(): string {
  return bytesToHex(generateRandomSalt(IDENTITY_SALT_BYTES));
}

export function computeIdentitySaltHex(input: Omit<IdentityHashInput, "passphrase"> & {
  schemaVersion?: number;
  cryptoSuiteVersion?: number;
  hashAlgoId?: number;
}): string {
  const canonicalFullName = canonicalizeFullName(input.fullName);
  const packedBirthGenderField = packBirthGenderField({
    isBirthBC: input.isBirthBC,
    birthYear: input.birthYear,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    gender: input.gender,
  });

  const encoded = ethers.solidityPacked(
    ["string", "uint16", "uint16", "uint16", "string", "bytes32"],
    [
      IDENTITY_SALT_DOMAIN,
      input.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
      input.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION,
      input.hashAlgoId ?? DEFAULT_HASH_ALGO_ID,
      canonicalFullName,
      ethers.zeroPadValue(ethers.toBeHex(packedBirthGenderField), 32),
    ],
  );

  return bytesToHex(ethers.getBytes(ethers.keccak256(encoded)).slice(0, 16));
}

export async function computeIdentityHashMaterial(
  input: IdentityHashInput & {
    schemaVersion?: number;
    cryptoSuiteVersion?: number;
    hashAlgoId?: number;
  },
): Promise<IdentityHashComputation> {
  const canonicalFullName = canonicalizeFullName(input.fullName);
  const schemaVersion = input.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion = input.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = input.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const identityMode = input.identityMode ?? "deterministic";
  const normalizedPassphrase = normalizePassphraseForHash(input.passphrase || "");

  let derivedSecretField = 0n;
  let derivedSecretBundle: DerivedSecretBundle | null = null;
  let identitySaltHex: string | null = null;

  if (normalizedPassphrase.length > 0) {
    if (identityMode === "random") {
      identitySaltHex = normalizeIdentitySaltHex(input.identitySaltHex || "");
    } else {
      identitySaltHex = computeIdentitySaltHex({
        fullName: canonicalFullName,
        isBirthBC: input.isBirthBC,
        birthYear: input.birthYear,
        birthMonth: input.birthMonth,
        birthDay: input.birthDay,
        gender: input.gender,
        schemaVersion,
        cryptoSuiteVersion,
        hashAlgoId,
      });
    }
    derivedSecretBundle = await deriveIdentitySecret({
      passphrase: normalizedPassphrase,
      salt: hexToBytes(identitySaltHex),
    });
    derivedSecretField = mapBytesToSnarkField(hexToBytes(derivedSecretBundle.derivedSecretHex));
  }

  const computed = computePersonHashFromData({
    fullName: canonicalFullName,
    derivedSecretField,
    isBirthBC: input.isBirthBC,
    birthYear: input.birthYear,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    gender: input.gender,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  });

  return {
    identityMode,
    canonicalFullName,
    personHash: computed.personHash,
    identityCommitment: computed.identityCommitment,
    nameField: computed.nameField,
    suiteCommitment: computed.suiteCommitment,
    packedBirthGenderField: computed.packedBirthGenderField,
    derivedSecretField,
    derivedSecretBundle,
    identitySaltHex,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };
}

export async function computePersonHash(input: IdentityHashInput): Promise<string> {
  try {
    return (await computeIdentityHashMaterial(input)).personHash;
  } catch {
    return "";
  }
}

export const computeIdentityHash = computePersonHash;
