import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import {
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_CRYPTO_SUITE_VERSION,
  DEFAULT_HASH_ALGO_ID,
  DEFAULT_PROOF_SYSTEM_ID,
  resolveArtifactFile,
  resolveDescriptorNodeArtifactCandidates,
  normalizeAddressDecimal,
  normalizeGroth16Proof,
  formatProofEnvelope,
} from "./proofCommon.js";
import { PERSON_COMMITMENT_PROOF_DESCRIPTOR } from "./proofDescriptors.js";
import {
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
  decodePersonCommitmentPublicSignals,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
const DOMAIN_SUITE = 1000n;
const DOMAIN_NAME_SECRET = 1001n;
const DOMAIN_IDENTITY = 1002n;

const DEFAULT_WASM_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  "wasm",
);
const DEFAULT_ZKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  "zkey",
);

function canonicalizeFullName(value) {
  if (value === undefined || value === null) return "";
  const normalized = typeof String(value).normalize === "function"
    ? String(value).normalize("NFKC")
    : String(value);
  return normalized.replace(/\s+/gu, " ").trim();
}

function toBigIntOrZero(value) {
  if (value === undefined || value === null || value === "") return 0n;
  return BigInt(value);
}

function computeNameField(fullName) {
  const canonicalFullName = canonicalizeFullName(fullName);
  if (!canonicalFullName) {
    throw new Error("Full name must be a non-empty string");
  }
  const domainBytes = ethers.toUtf8Bytes(DOMAIN_NAME_PREHASH);
  const nameBytes = ethers.toUtf8Bytes(canonicalFullName);
  const prehash = ethers.keccak256(ethers.concat([domainBytes, nameBytes]));
  return BigInt(prehash) % SNARK_FIELD;
}

function computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId) {
  return poseidon4([
    DOMAIN_SUITE,
    BigInt(schemaVersion),
    BigInt(cryptoSuiteVersion),
    BigInt(hashAlgoId),
  ]);
}

function packBirthGenderField(input) {
  return (
    (BigInt(input.birthYear ?? 0) << 25n) |
    (BigInt(input.birthMonth ?? 0) << 17n) |
    (BigInt(input.birthDay ?? 0) << 9n) |
    (BigInt(input.gender ?? 0) << 1n) |
    (input.isBirthBC ? 1n : 0n)
  );
}

function computePersonIdentityCommitment(person, suiteCommitment) {
  const nameField = computeNameField(person.fullName);
  const derivedSecretField = toBigIntOrZero(person.derivedSecretField);
  const nameSecretCommitment = poseidon4([
    DOMAIN_NAME_SECRET,
    nameField,
    derivedSecretField,
    suiteCommitment,
  ]);
  const packedBirthGenderField = packBirthGenderField(person);
  const identityCommitment = poseidon4([
    DOMAIN_IDENTITY,
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  ]);
  const personHash = ethers.keccak256(`0x${identityCommitment.toString(16).padStart(64, "0")}`);
  return {
    canonicalFullName: canonicalizeFullName(person.fullName),
    nameField,
    derivedSecretField,
    packedBirthGenderField,
    nameSecretCommitment,
    identityCommitment,
    personHash,
  };
}

function normalizeCircuitPerson(person, { allowEmpty = false } = {}) {
  const canonicalFullName = canonicalizeFullName(person?.fullName);
  if (!canonicalFullName) {
    if (allowEmpty) {
      return {
        canonicalFullName: "",
        nameField: 0n,
        derivedSecretField: 0n,
        isBirthBC: false,
        birthYear: 0,
        birthMonth: 0,
        birthDay: 0,
        gender: 0,
      };
    }
    throw new Error("Full name must be a non-empty string");
  }

  return {
    canonicalFullName,
    nameField: computeNameField(canonicalFullName),
    derivedSecretField: toBigIntOrZero(person?.derivedSecretField),
    isBirthBC: Boolean(person?.isBirthBC),
    birthYear: Number(person?.birthYear ?? 0),
    birthMonth: Number(person?.birthMonth ?? 0),
    birthDay: Number(person?.birthDay ?? 0),
    gender: Number(person?.gender ?? 0),
  };
}

function normalizeSignals(publicSignals) {
  return normalizePublicSignalsForSpec(publicSignals, PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC, {
    label: "Person commitment",
  });
}

function assertSignalMatches(fieldName, actual, expected) {
  const normalizedExpected = BigInt(expected);
  if (actual !== normalizedExpected) {
    throw new Error(
      `Person commitment ${fieldName} public signal mismatch ` +
        `(expected ${normalizedExpected}, got ${actual})`,
    );
  }
}

export function assertPersonCommitmentPublicSignalsMatch(built, publicSignals) {
  const normalizedSignals = normalizeSignals(publicSignals);
  const decoded = decodePersonCommitmentPublicSignals(normalizedSignals);
  const expected = {
    identityCommitment: built.person.identityCommitment,
    fatherIdentityCommitment: built.father?.identityCommitment ?? 0n,
    motherIdentityCommitment: built.mother?.identityCommitment ?? 0n,
    submitter: built.submitter,
    schemaVersion: built.schemaVersion,
    cryptoSuiteVersion: built.cryptoSuiteVersion,
    hashAlgoId: built.hashAlgoId,
  };

  for (const fieldName of PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder) {
    assertSignalMatches(fieldName, decoded[fieldName], expected[fieldName]);
  }

  return decoded;
}

export function computePersonHashFromInput(person, opts = {}) {
  const schemaVersion = opts.schemaVersion ?? person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion =
    opts.cryptoSuiteVersion ?? person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = opts.hashAlgoId ?? person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const suiteCommitment = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  return {
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
    suiteCommitment,
    ...computePersonIdentityCommitment(person, suiteCommitment),
  };
}

export function buildPersonCommitmentInput(person, father, mother, submitterAddress, opts = {}) {
  const schemaVersion = opts.schemaVersion ?? person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion =
    opts.cryptoSuiteVersion ?? person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = opts.hashAlgoId ?? person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const submitter = normalizeAddressDecimal(submitterAddress, "submitter");

  const personFields = normalizeCircuitPerson(person);
  const fatherFields = normalizeCircuitPerson(father, { allowEmpty: true });
  const motherFields = normalizeCircuitPerson(mother, { allowEmpty: true });
  const suiteCommitment = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const personCommitment = computePersonIdentityCommitment(person, suiteCommitment);
  const fatherCommitment = fatherFields.canonicalFullName
    ? computePersonIdentityCommitment(father, suiteCommitment)
    : null;
  const motherCommitment = motherFields.canonicalFullName
    ? computePersonIdentityCommitment(mother, suiteCommitment)
    : null;

  const input = {
    nameField: personFields.nameField.toString(),
    derivedSecretField: personFields.derivedSecretField.toString(),
    isBirthBC: personFields.isBirthBC ? 1 : 0,
    birthYear: personFields.birthYear,
    birthMonth: personFields.birthMonth,
    birthDay: personFields.birthDay,
    gender: personFields.gender,
    fatherNameField: fatherFields.nameField.toString(),
    fatherDerivedSecretField: fatherFields.derivedSecretField.toString(),
    fatherIsBirthBC: fatherFields.isBirthBC ? 1 : 0,
    fatherBirthYear: fatherFields.birthYear,
    fatherBirthMonth: fatherFields.birthMonth,
    fatherBirthDay: fatherFields.birthDay,
    fatherGender: fatherFields.gender,
    motherNameField: motherFields.nameField.toString(),
    motherDerivedSecretField: motherFields.derivedSecretField.toString(),
    motherIsBirthBC: motherFields.isBirthBC ? 1 : 0,
    motherBirthYear: motherFields.birthYear,
    motherBirthMonth: motherFields.birthMonth,
    motherBirthDay: motherFields.birthDay,
    motherGender: motherFields.gender,
    hasFather: fatherFields.canonicalFullName ? 1 : 0,
    hasMother: motherFields.canonicalFullName ? 1 : 0,
    submitter,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };

  return {
    input,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
    proofSystemId:
      opts.proofSystemId ??
      PERSON_COMMITMENT_PROOF_DESCRIPTOR.proofSystemId ??
      DEFAULT_PROOF_SYSTEM_ID,
    submitter,
    suiteCommitment,
    person: personCommitment,
    father: fatherCommitment,
    mother: motherCommitment,
    descriptor: PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  };
}

export async function generatePersonCommitmentProof(
  person,
  father,
  mother,
  submitterAddress,
  opts = {},
) {
  const built = buildPersonCommitmentInput(person, father, mother, submitterAddress, opts);
  const wasmPath = resolveArtifactFile(
    "Person commitment circuit wasm",
    opts.wasm,
    DEFAULT_WASM_CANDIDATES,
  );
  const zkeyPath = resolveArtifactFile(
    "Person commitment circuit zkey",
    opts.zkey,
    DEFAULT_ZKEY_CANDIDATES,
  );

  if (PERSON_COMMITMENT_PROOF_DESCRIPTOR.proverDriver !== "snarkjs-groth16") {
    throw new Error(
      `Unsupported prover driver: ${PERSON_COMMITMENT_PROOF_DESCRIPTOR.proverDriver}`,
    );
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, wasmPath, zkeyPath);
  const normalizedProof = normalizeGroth16Proof(proof);
  const normalizedSignals = normalizeSignals(publicSignals);
  const publicSignalsStruct = assertPersonCommitmentPublicSignalsMatch(built, normalizedSignals);

  return {
    ...built,
    proof: normalizedProof,
    publicSignals: normalizedSignals,
    publicSignalsStruct,
    proofEnvelope: formatProofEnvelope(normalizedProof, built),
    meta: {
      schemaVersion: built.schemaVersion,
      cryptoSuiteVersion: built.cryptoSuiteVersion,
      hashAlgoId: built.hashAlgoId,
    },
    artifacts: {
      wasm: wasmPath,
      zkey: zkeyPath,
    },
    descriptor: PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  };
}

export default {
  assertPersonCommitmentPublicSignalsMatch,
  buildPersonCommitmentInput,
  computePersonHashFromInput,
  generatePersonCommitmentProof,
};
