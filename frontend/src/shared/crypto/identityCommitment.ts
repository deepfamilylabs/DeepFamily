import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";
import {
  hexToBytes,
  mapBytesToSnarkField,
  type DerivedSecretBundle,
} from "./secretDerivation";

export type CanonicalIdentityInput = {
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

export type CanonicalizedIdentity = Omit<CanonicalIdentityInput, "passphrase"> & {
  canonicalFullName: string;
};

export type IdentityCommitmentResult = {
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
const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
const DOMAIN_SUITE = 1000n;
const DOMAIN_NAME_SECRET = 1001n;
const DOMAIN_IDENTITY = 1002n;

export function canonicalizeFullName(value: string): string {
  if (typeof value !== "string") return "";
  const normalized = typeof value.normalize === "function" ? value.normalize("NFKC") : value;
  const collapsedWhitespace = normalized.replace(/\s+/gu, " ").trim();
  if (!collapsedWhitespace) throw new Error("Canonical full name cannot be empty");
  return collapsedWhitespace;
}

export function safeCanonicalizeFullName(value: string): string {
  try {
    return canonicalizeFullName(value);
  } catch {
    return "";
  }
}

export function canonicalizeIdentityInput(input: CanonicalIdentityInput): CanonicalizedIdentity {
  return {
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
    canonicalFullName: canonicalizeFullName(input.fullName),
    fullName: input.fullName,
    isBirthBC: input.isBirthBC,
    birthYear: input.birthYear,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    gender: input.gender,
  };
}

export function computeNamePrehash(canonicalFullName: string): string {
  const bytes = textEncoder.encode(canonicalFullName);
  const domainBytes = textEncoder.encode(DOMAIN_NAME_PREHASH);
  return ethers.keccak256(ethers.concat([domainBytes, bytes]));
}

export function computeNameField(namePrehash: string): bigint {
  return mapBytesToSnarkField(hexToBytes(namePrehash));
}

export function packBirthGenderField(input: {
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

export function computeSuiteCommitment(input: {
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
}): bigint {
  return poseidon4([
    DOMAIN_SUITE,
    BigInt(input.schemaVersion),
    BigInt(input.cryptoSuiteVersion),
    BigInt(input.hashAlgoId),
  ]);
}

export function computeNameSecretCommitment(input: {
  nameField: bigint;
  derivedSecretField: bigint;
  suiteCommitment: bigint;
}): bigint {
  return poseidon4([
    DOMAIN_NAME_SECRET,
    input.nameField,
    input.derivedSecretField,
    input.suiteCommitment,
  ]);
}

export function computeIdentityCommitmentFromFields(input: {
  nameSecretCommitment: bigint;
  packedBirthGenderField: bigint;
  suiteCommitment: bigint;
}): bigint {
  return poseidon4([
    DOMAIN_IDENTITY,
    input.nameSecretCommitment,
    input.packedBirthGenderField,
    input.suiteCommitment,
  ]);
}

export function wrapIdentityCommitmentAsPersonHash(identityCommitment: bigint): string {
  const hex = `0x${identityCommitment.toString(16).padStart(64, "0")}`;
  return ethers.keccak256(hex);
}

export function derivedSecretHexToField(derivedSecretHex: string): bigint {
  return mapBytesToSnarkField(hexToBytes(derivedSecretHex));
}

export function computeIdentityCommitment(input: {
  canonicalInput: CanonicalIdentityInput;
  derivedSecretBundle: DerivedSecretBundle;
}): IdentityCommitmentResult {
  const canonical = canonicalizeIdentityInput(input.canonicalInput);
  const canonicalFullNameBytes = textEncoder.encode(canonical.canonicalFullName);
  const namePrehash = computeNamePrehash(canonical.canonicalFullName);
  const nameField = computeNameField(namePrehash);
  const derivedSecretField = derivedSecretHexToField(input.derivedSecretBundle.derivedSecretHex);
  const packedBirthGenderField = packBirthGenderField(canonical);
  const suiteCommitment = computeSuiteCommitment({
    schemaVersion: canonical.schemaVersion,
    cryptoSuiteVersion: canonical.cryptoSuiteVersion,
    hashAlgoId: canonical.hashAlgoId,
  });
  const nameSecretCommitment = computeNameSecretCommitment({
    nameField,
    derivedSecretField,
    suiteCommitment,
  });
  const identityCommitment = computeIdentityCommitmentFromFields({
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  });
  const personHash = wrapIdentityCommitmentAsPersonHash(identityCommitment);

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
