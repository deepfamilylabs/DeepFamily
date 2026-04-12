import { poseidon4 } from "poseidon-lite";
import {
  computeIdentityCommitment,
  computeNameField,
  computeNamePrehash,
  canonicalizeFullName,
  computeSuiteCommitment,
  packBirthGenderField,
  type CanonicalIdentityInput,
} from "./identityCommitment";
import type { DerivedSecretBundle } from "./secretDerivation";

export type DisclosureBindingResult = {
  canonicalFullName: string;
  namePrehash: string;
  nameField: bigint;
  packedBirthGenderField: bigint;
  suiteCommitment: bigint;
  disclosureBinding: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

export type MintDisclosureInputs = {
  fullName: string;
  disclosureBindingHex: string;
  identityCommitmentHex: string;
  personHash: string;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

const DOMAIN_DISCLOSURE = 1003n;

export function computeDisclosureBinding(input: {
  nameField: bigint;
  packedBirthGenderField: bigint;
  suiteCommitment: bigint;
}): bigint {
  return poseidon4([
    DOMAIN_DISCLOSURE,
    input.nameField,
    input.packedBirthGenderField,
    input.suiteCommitment,
  ]);
}

export function computeDisclosureBindingFromFullName(input: {
  fullName: string;
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
}): DisclosureBindingResult {
  const canonicalFullName = canonicalizeFullName(input.fullName);
  const namePrehash = computeNamePrehash(canonicalFullName);
  const nameField = computeNameField(namePrehash);
  const packedBirthGenderField = packBirthGenderField({
    isBirthBC: input.isBirthBC,
    birthYear: input.birthYear,
    birthMonth: input.birthMonth,
    birthDay: input.birthDay,
    gender: input.gender,
  });
  const suiteCommitment = computeSuiteCommitment({
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  });
  const disclosureBinding = computeDisclosureBinding({
    nameField,
    packedBirthGenderField,
    suiteCommitment,
  });

  return {
    canonicalFullName,
    namePrehash,
    nameField,
    packedBirthGenderField,
    suiteCommitment,
    disclosureBinding,
    schemaVersion: input.schemaVersion,
    cryptoSuiteVersion: input.cryptoSuiteVersion,
    hashAlgoId: input.hashAlgoId,
  };
}

export function createDisclosureBinding(input: {
  fullName: string;
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
}): DisclosureBindingResult {
  return computeDisclosureBindingFromFullName(input);
}

export function bigintTo32ByteHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export function buildMintDisclosureInputs(input: {
  canonicalInput: CanonicalIdentityInput;
  derivedSecretBundle: DerivedSecretBundle;
}): MintDisclosureInputs {
  const identity = computeIdentityCommitment({
    canonicalInput: input.canonicalInput,
    derivedSecretBundle: input.derivedSecretBundle,
  });
  const disclosure = createDisclosureBinding({
    fullName: input.canonicalInput.fullName,
    isBirthBC: input.canonicalInput.isBirthBC,
    birthYear: input.canonicalInput.birthYear,
    birthMonth: input.canonicalInput.birthMonth,
    birthDay: input.canonicalInput.birthDay,
    gender: input.canonicalInput.gender,
    schemaVersion: input.canonicalInput.schemaVersion,
    cryptoSuiteVersion: input.canonicalInput.cryptoSuiteVersion,
    hashAlgoId: input.canonicalInput.hashAlgoId,
  });

  return {
    fullName: identity.canonicalFullName,
    disclosureBindingHex: bigintTo32ByteHex(disclosure.disclosureBinding),
    identityCommitmentHex: bigintTo32ByteHex(identity.identityCommitment),
    personHash: identity.personHash,
    schemaVersion: input.canonicalInput.schemaVersion,
    cryptoSuiteVersion: input.canonicalInput.cryptoSuiteVersion,
    hashAlgoId: input.canonicalInput.hashAlgoId,
  };
}
