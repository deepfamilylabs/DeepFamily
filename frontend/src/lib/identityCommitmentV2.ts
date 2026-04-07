import { ethers } from "ethers";
import { poseidon4, poseidon5 } from "poseidon-lite";
import {
  hexToBytes,
  mapBytesToSnarkField,
  type DerivedSecretBundleV2,
} from "./secretDerivation";

export type CanonicalIdentityInputV2 = {
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
  fullName: string;
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
  passphrase: string;
};

export type CanonicalizedIdentityV2 = Omit<CanonicalIdentityInputV2, "passphrase"> & {
  canonicalFullName: string;
};

export type IdentityCommitmentV2Result = {
  canonicalFullName: string;
  canonicalFullNameBytes: Uint8Array;
  namePrehash: string;
  nameField: bigint;
  derivedSecretField: bigint;
  packedBirthGenderField: bigint;
  suiteCommitment: bigint;
  nameSecretCommitment: bigint;
  identityCommitment: bigint;
  personHash: string;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

const textEncoder = new TextEncoder();
const DOMAIN_NAME_PREHASH_V2 = "deepfamily:name-prehash:v2";
const DOMAIN_SUITE_V2 = 1000n;
const DOMAIN_NAME_SECRET_V2 = 1001n;
const DOMAIN_IDENTITY_V2 = 1002n;

export function canonicalizeFullNameV2(value: string): string {
  if (typeof value !== "string") return "";
  const normalized = typeof value.normalize === "function" ? value.normalize("NFKC") : value;
  const collapsedWhitespace = normalized.replace(/\s+/gu, " ").trim();
  if (!collapsedWhitespace) throw new Error("Canonical full name cannot be empty");
  return collapsedWhitespace;
}

export function canonicalizeIdentityInputV2(input: CanonicalIdentityInputV2): CanonicalizedIdentityV2 {
  return {
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
    canonicalFullName: canonicalizeFullNameV2(input.fullName),
    fullName: input.fullName,
    isBirthBC: input.isBirthBC,
    birthYear: input.birthYear,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    gender: input.gender,
  };
}

export function computeNamePrehashV2(canonicalFullName: string): string {
  const bytes = textEncoder.encode(canonicalFullName);
  const domainBytes = textEncoder.encode(DOMAIN_NAME_PREHASH_V2);
  return ethers.keccak256(ethers.concat([domainBytes, bytes]));
}

export function computeNameFieldV2(namePrehash: string): bigint {
  return mapBytesToSnarkField(hexToBytes(namePrehash));
}

export function packBirthGenderFieldV2(input: {
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
}): bigint {
  return (
    (BigInt(input.birthYear) << 24n) |
    (BigInt(input.birthMonth) << 16n) |
    (BigInt(input.birthDay) << 8n) |
    (BigInt(input.gender) << 1n) |
    (input.isBirthBC ? 1n : 0n)
  );
}

export function computeSuiteCommitmentV2(input: {
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
}): bigint {
  return poseidon4([
    DOMAIN_SUITE_V2,
    BigInt(input.schemaVersion),
    BigInt(input.cryptoSuiteVersion),
    BigInt(input.hashAlgoId),
  ]);
}

export function computeNameSecretCommitmentV2(input: {
  nameField: bigint;
  derivedSecretField: bigint;
  suiteCommitment: bigint;
}): bigint {
  return poseidon4([
    DOMAIN_NAME_SECRET_V2,
    input.nameField,
    input.derivedSecretField,
    input.suiteCommitment,
  ]);
}

export function computeIdentityCommitmentV2FromFields(input: {
  nameSecretCommitment: bigint;
  packedBirthGenderField: bigint;
  suiteCommitment: bigint;
}): bigint {
  return poseidon4([
    DOMAIN_IDENTITY_V2,
    input.nameSecretCommitment,
    input.packedBirthGenderField,
    input.suiteCommitment,
  ]);
}

export function wrapIdentityCommitmentAsPersonHashV2(identityCommitment: bigint): string {
  const hex = `0x${identityCommitment.toString(16).padStart(64, "0")}`;
  return ethers.keccak256(hex);
}

export function derivedSecretHexToField(derivedSecretHex: string): bigint {
  return mapBytesToSnarkField(hexToBytes(derivedSecretHex));
}

export function computeIdentityCommitmentV2(input: {
  canonicalInput: CanonicalIdentityInputV2;
  derivedSecretBundle: DerivedSecretBundleV2;
}): IdentityCommitmentV2Result {
  const canonical = canonicalizeIdentityInputV2(input.canonicalInput);
  const canonicalFullNameBytes = textEncoder.encode(canonical.canonicalFullName);
  const namePrehash = computeNamePrehashV2(canonical.canonicalFullName);
  const nameField = computeNameFieldV2(namePrehash);
  const derivedSecretField = derivedSecretHexToField(input.derivedSecretBundle.derivedSecretHex);
  const packedBirthGenderField = packBirthGenderFieldV2(canonical);
  const suiteCommitment = computeSuiteCommitmentV2({
    schemaVersion: canonical.schemaVersion,
    cryptoSuiteVersion: canonical.cryptoSuiteVersion,
    hashAlgoId: canonical.hashAlgoId,
  });
  const nameSecretCommitment = computeNameSecretCommitmentV2({
    nameField,
    derivedSecretField,
    suiteCommitment,
  });
  const identityCommitment = computeIdentityCommitmentV2FromFields({
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  });
  const personHash = wrapIdentityCommitmentAsPersonHashV2(identityCommitment);

  return {
    canonicalFullName: canonical.canonicalFullName,
    canonicalFullNameBytes,
    namePrehash,
    nameField,
    derivedSecretField,
    packedBirthGenderField,
    suiteCommitment,
    nameSecretCommitment,
    identityCommitment,
    personHash,
    schemaVersion: canonical.schemaVersion,
    cryptoSuiteVersion: canonical.cryptoSuiteVersion,
    hashAlgoId: canonical.hashAlgoId,
  };
}
