import { poseidon4 } from "poseidon-lite";
import {
  DEFAULT_SALT_BYTES,
  generateRandomSalt,
  hexToBytes,
  mapBytesToSnarkField,
  bytesToHex,
} from "./secretDerivation";
import {
  computeIdentityCommitmentV2,
  computeNameFieldV2,
  computeNamePrehashV2,
  canonicalizeFullNameV2,
  computeSuiteCommitmentV2,
  type CanonicalIdentityInputV2,
} from "./identityCommitmentV2";
import type { DerivedSecretBundleV2 } from "./secretDerivation";

export type DisclosureBindingV2Result = {
  canonicalFullName: string;
  namePrehash: string;
  nameField: bigint;
  disclosureNonceHex: string;
  disclosureNonceField: bigint;
  suiteCommitment: bigint;
  disclosureBinding: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

export type MintDisclosureInputsV2 = {
  fullName: string;
  disclosureNonceHex: string;
  disclosureBindingHex: string;
  identityCommitmentHex: string;
  personHash: string;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

const DOMAIN_DISCLOSURE_V2 = 1003n;

export function generateDisclosureNonce(byteLength: number = 32): Uint8Array {
  return generateRandomSalt(byteLength || DEFAULT_SALT_BYTES);
}

export function disclosureNonceHexToField(disclosureNonceHex: string): bigint {
  return mapBytesToSnarkField(hexToBytes(disclosureNonceHex));
}

export function computeDisclosureBindingV2(input: {
  nameField: bigint;
  disclosureNonceField: bigint;
  suiteCommitment: bigint;
}): bigint {
  return poseidon4([
    DOMAIN_DISCLOSURE_V2,
    input.nameField,
    input.disclosureNonceField,
    input.suiteCommitment,
  ]);
}

export function computeDisclosureBindingV2FromFullName(input: {
  fullName: string;
  disclosureNonceHex: string;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
}): DisclosureBindingV2Result {
  const canonicalFullName = canonicalizeFullNameV2(input.fullName);
  const namePrehash = computeNamePrehashV2(canonicalFullName);
  const nameField = computeNameFieldV2(namePrehash);
  const disclosureNonceField = disclosureNonceHexToField(input.disclosureNonceHex);
  const suiteCommitment = computeSuiteCommitmentV2({
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  });
  const disclosureBinding = computeDisclosureBindingV2({
    nameField,
    disclosureNonceField,
    suiteCommitment,
  });

  return {
    canonicalFullName,
    namePrehash,
    nameField,
    disclosureNonceHex: input.disclosureNonceHex,
    disclosureNonceField,
    suiteCommitment,
    disclosureBinding,
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  };
}

export function createDisclosureBindingV2(input: {
  fullName: string;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
  disclosureNonce?: Uint8Array;
}): DisclosureBindingV2Result {
  const nonce = input.disclosureNonce ?? generateDisclosureNonce(32);
  return computeDisclosureBindingV2FromFullName({
    fullName: input.fullName,
    disclosureNonceHex: bytesToHex(nonce),
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  });
}

export function bigintTo32ByteHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export function buildMintDisclosureInputsV2(input: {
  canonicalInput: CanonicalIdentityInputV2;
  derivedSecretBundle: DerivedSecretBundleV2;
  disclosureNonce?: Uint8Array;
}): MintDisclosureInputsV2 {
  const identity = computeIdentityCommitmentV2({
    canonicalInput: input.canonicalInput,
    derivedSecretBundle: input.derivedSecretBundle,
  });
  const disclosure = createDisclosureBindingV2({
    fullName: input.canonicalInput.fullName,
    schemaVersion: input.canonicalInput.schemaVersion,
    cryptoSuiteVersion: input.canonicalInput.cryptoSuiteVersion,
    hashAlgoId: input.canonicalInput.hashAlgoId,
    disclosureNonce: input.disclosureNonce,
  });

  return {
    fullName: identity.canonicalFullName,
    disclosureNonceHex: disclosure.disclosureNonceHex,
    disclosureBindingHex: bigintTo32ByteHex(disclosure.disclosureBinding),
    identityCommitmentHex: bigintTo32ByteHex(identity.identityCommitment),
    personHash: identity.personHash,
    schemaVersion: input.canonicalInput.schemaVersion,
    cryptoSuiteVersion: input.canonicalInput.cryptoSuiteVersion,
    hashAlgoId: input.canonicalInput.hashAlgoId,
  };
}
