import { concat, keccak256, solidityPacked, toBeHex, toUtf8Bytes, zeroPadValue } from "ethers";
import { poseidon4 } from "poseidon-lite";
import {
  DEFAULT_PROOF_ENCODING_ID as CODEC_DEFAULT_PROOF_ENCODING_ID,
  packGroth16ProofEnvelope,
  type ProofEnvelope as CodecProofEnvelope,
} from "@deepfamily/proof-core";
import { canonicalizeFullName } from "../crypto/identityCommitment";

export type Groth16Proof = {
  pi_a: [string | bigint, string | bigint, string | bigint];
  pi_b: [
    [string | bigint, string | bigint],
    [string | bigint, string | bigint],
    [string | bigint, string | bigint],
  ];
  pi_c: [string | bigint, string | bigint, string | bigint];
  protocol: string;
  curve: string;
};

export const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEFAULT_IDENTITY_SUITE_ID = 1;
export const DEFAULT_PROOF_ENCODING_ID = CODEC_DEFAULT_PROOF_ENCODING_ID;
export const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
export const DOMAIN_SUITE = 1000n;
export const DOMAIN_NAME_SECRET = 1001n;
export const DOMAIN_IDENTITY = 1002n;
export const DOMAIN_DISCLOSURE = 1003n;
export const DOMAIN_VERSION_COMMITMENT = 1004n;

const UINT32_MAX = (1n << 32n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;

export interface PersonData {
  fullName: string;
  derivedSecretField: bigint;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
  gender: number;
  identitySuiteId?: number;
}

function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function normalizeIdentitySuiteId(
  value: string | number | bigint,
  options: { allowZero?: boolean; label?: string } = {},
): bigint {
  const suiteId = toBigInt(value);
  const minimum = options.allowZero ? 0n : 1n;
  if (suiteId < minimum || suiteId > UINT32_MAX) {
    throw new Error(`${options.label ?? "identitySuiteId"} must be a nonzero uint32`);
  }
  return suiteId;
}

export function computeNameField(fullName: string): bigint {
  const canonicalFullName = canonicalizeFullName(fullName);
  const prehash = keccak256(
    concat([toUtf8Bytes(DOMAIN_NAME_PREHASH), toUtf8Bytes(canonicalFullName)]),
  );
  return BigInt(prehash) % SNARK_FIELD;
}

export function computeAtomicSuiteCommitment(identitySuiteId: string | number | bigint): bigint {
  const suiteId = normalizeIdentitySuiteId(identitySuiteId, { allowZero: true });
  return poseidon4([DOMAIN_SUITE, suiteId, 0n, 0n]);
}

function assertIntegerInRange(value: number, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer in [0, ${maximum}]`);
  }
}

export function packBirthGenderField(input: {
  isBirthBC: boolean;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
}): bigint {
  if (typeof input.isBirthBC !== "boolean") throw new Error("isBirthBC must be boolean");
  assertIntegerInRange(input.birthYear, "birthYear", 65535);
  assertIntegerInRange(input.birthMonth, "birthMonth", 12);
  assertIntegerInRange(input.birthDay, "birthDay", 31);
  assertIntegerInRange(input.gender, "gender", 255);
  return (
    (BigInt(input.birthYear) << 25n) |
    (BigInt(input.birthMonth) << 17n) |
    (BigInt(input.birthDay) << 9n) |
    (BigInt(input.gender) << 1n) |
    (input.isBirthBC ? 1n : 0n)
  );
}

export function computeNameSecretCommitment(
  nameField: bigint,
  derivedSecretField: bigint,
  suiteCommitment: bigint,
): bigint {
  return poseidon4([DOMAIN_NAME_SECRET, nameField, derivedSecretField, suiteCommitment]);
}

export function computeIdentityCommitment(
  nameSecretCommitment: bigint,
  packedBirthGenderField: bigint,
  suiteCommitment: bigint,
): bigint {
  return poseidon4([
    DOMAIN_IDENTITY,
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  ]);
}

export function computeDisclosureBinding(
  nameField: bigint,
  packedBirthGenderField: bigint,
  suiteCommitment: bigint,
): bigint {
  return poseidon4([DOMAIN_DISCLOSURE, nameField, packedBirthGenderField, suiteCommitment]);
}

export function computeVersionCommitment(
  derivedSecretField: bigint,
  contentDigestLo: string | number | bigint,
  contentDigestHi: string | number | bigint,
): bigint {
  const lo = toBigInt(contentDigestLo);
  const hi = toBigInt(contentDigestHi);
  if (lo < 0n || lo > UINT128_MAX) throw new Error("contentDigestLo must be a uint128");
  if (hi < 0n || hi > UINT128_MAX) throw new Error("contentDigestHi must be a uint128");
  return poseidon4([DOMAIN_VERSION_COMMITMENT, derivedSecretField, lo, hi]);
}

export function wrapIdentityCommitmentAsPersonHash(identityCommitment: bigint): string {
  const hex = zeroPadValue(toBeHex(identityCommitment), 32);
  return keccak256(solidityPacked(["bytes32"], [hex]));
}

export function computePersonHashFromData(
  person: PersonData,
  identitySuiteId: string | number | bigint = person.identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
): {
  identityCommitment: bigint;
  personHash: string;
  nameField: bigint;
  suiteCommitment: bigint;
  packedBirthGenderField: bigint;
} {
  const suiteCommitment = computeAtomicSuiteCommitment(
    normalizeIdentitySuiteId(identitySuiteId, { label: "identitySuiteId" }),
  );
  const nameField = computeNameField(person.fullName);
  const nameSecretCommitment = computeNameSecretCommitment(
    nameField,
    person.derivedSecretField,
    suiteCommitment,
  );
  const packedBirthGenderField = packBirthGenderField(person);
  const identityCommitment = computeIdentityCommitment(
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  );
  return {
    identityCommitment,
    personHash: wrapIdentityCommitmentAsPersonHash(identityCommitment),
    nameField,
    suiteCommitment,
    packedBirthGenderField,
  };
}

export type ProofEnvelope = CodecProofEnvelope;

export function formatGroth16ProofForContract(
  proof: Groth16Proof,
  options: { circuitId: number; proofEncodingId?: number },
): ProofEnvelope {
  return packGroth16ProofEnvelope(proof, options);
}

export function toBigIntArray(values: Array<string | number | bigint>): bigint[] {
  return values.map(toBigInt);
}
