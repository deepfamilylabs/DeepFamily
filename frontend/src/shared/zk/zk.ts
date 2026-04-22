import {
  keccak256,
  concat,
  toUtf8Bytes,
  zeroPadValue,
  toBeHex,
  solidityPacked,
} from "ethers";
import { poseidon4 } from "poseidon-lite";
import { canonicalizeFullName } from "../crypto/identityCommitment";
import {
  DEFAULT_PROOF_SYSTEM_ID as CODEC_DEFAULT_PROOF_SYSTEM_ID,
  DEFAULT_PROOF_ENCODING_ID as CODEC_DEFAULT_PROOF_ENCODING_ID,
  packGroth16ProofEnvelope,
  type ProofEnvelope as CodecProofEnvelope,
} from "../../../../lib/proofEnvelopeCodec.js";

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

export const SNARK_FIELD = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
const DOMAIN_SUITE = 1000n;
const DOMAIN_NAME_SECRET = 1001n;
const DOMAIN_IDENTITY = 1002n;
const DOMAIN_DISCLOSURE = 1003n;

export const DEFAULT_SCHEMA_VERSION = 1;
export const DEFAULT_CRYPTO_SUITE_VERSION = 1;
export const DEFAULT_HASH_ALGO_ID = 1;
export const DEFAULT_PROOF_SYSTEM_ID = CODEC_DEFAULT_PROOF_SYSTEM_ID;
export const DEFAULT_PROOF_ENCODING_ID = CODEC_DEFAULT_PROOF_ENCODING_ID;

export interface PersonData {
  fullName: string;
  derivedSecretField: bigint;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
  gender: number;
  schemaVersion?: number;
  cryptoSuiteVersion?: number;
  hashAlgoId?: number;
}

function toBigInt(v: string | number | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    if (v.startsWith("0x") || v.startsWith("0X")) return BigInt(v);
    return BigInt(v);
  }
  throw new Error("unsupported type");
}

export function computeNameField(fullName: string): bigint {
  const canonicalFullName = canonicalizeFullName(fullName);
  const domainBytes = toUtf8Bytes(DOMAIN_NAME_PREHASH);
  const nameBytes = toUtf8Bytes(canonicalFullName);
  const prehash = keccak256(concat([domainBytes, nameBytes]));
  return BigInt(prehash) % SNARK_FIELD;
}

export function computeSuiteCommitment(
  schemaVersion: number,
  cryptoSuiteVersion: number,
  hashAlgoId: number,
): bigint {
  return poseidon4([DOMAIN_SUITE, BigInt(schemaVersion), BigInt(cryptoSuiteVersion), BigInt(hashAlgoId)]);
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
  return poseidon4([DOMAIN_IDENTITY, nameSecretCommitment, packedBirthGenderField, suiteCommitment]);
}

export function computeDisclosureBinding(
  nameField: bigint,
  packedBirthGenderField: bigint,
  suiteCommitment: bigint,
): bigint {
  return poseidon4([DOMAIN_DISCLOSURE, nameField, packedBirthGenderField, suiteCommitment]);
}

export function wrapIdentityCommitmentAsPersonHash(identityCommitment: bigint): string {
  const hex = zeroPadValue(toBeHex(identityCommitment), 32);
  return keccak256(solidityPacked(["bytes32"], [hex]));
}

export function computePersonHashFromData(person: PersonData): {
  identityCommitment: bigint;
  personHash: string;
  nameField: bigint;
  suiteCommitment: bigint;
  packedBirthGenderField: bigint;
} {
  const schemaVersion = person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion = person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;

  const suite = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const nameField = computeNameField(person.fullName);
  const nsc = computeNameSecretCommitment(nameField, person.derivedSecretField, suite);
  const packed = packBirthGenderField(person);
  const ic = computeIdentityCommitment(nsc, packed, suite);
  const personHash = wrapIdentityCommitmentAsPersonHash(ic);

  return { identityCommitment: ic, personHash, nameField, suiteCommitment: suite, packedBirthGenderField: packed };
}

export type ProofEnvelope = CodecProofEnvelope;

export function formatGroth16ProofForContract(
  proof: Groth16Proof,
  opts?: { proofSystemId?: number; proofEncodingId?: number },
): ProofEnvelope {
  return packGroth16ProofEnvelope(proof, opts);
}

export function toBigIntArray(values: Array<string | number | bigint>): bigint[] {
  return values.map(toBigInt);
}
