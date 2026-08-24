import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { poseidon4 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import {
  formatProofEnvelope,
  normalizeAddressDecimal,
  normalizeGroth16Proof,
  resolveArtifactFile,
  resolveDescriptorNodeArtifactCandidates,
} from "./proofCommon.js";
import { PERSON_RELATION_PROOF_DESCRIPTOR } from "./proofDescriptors.js";
import {
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
  decodePersonRelationPublicSignals,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";
import { canonicalizeFullName as canonicalizeProtocolFullName } from "@deepfamily/protocol-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEFAULT_IDENTITY_SUITE_ID = 1;
export const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
export const DOMAIN_SUITE = 1000n;
export const DOMAIN_NAME_SECRET = 1001n;
export const DOMAIN_IDENTITY = 1002n;
export const DOMAIN_VERSION_COMMITMENT = 1004n;

const UINT32_MAX = (1n << 32n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;

const DEFAULT_WASM_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_RELATION_PROOF_DESCRIPTOR,
  "wasm",
);
const DEFAULT_ZKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  PERSON_RELATION_PROOF_DESCRIPTOR,
  "zkey",
);

export const canonicalizeFullName = canonicalizeProtocolFullName;

function normalizeFieldElement(value, label) {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized >= SNARK_FIELD) {
    throw new Error(`${label} must be a canonical BN254 scalar-field element`);
  }
  return normalized;
}

export function normalizeIdentitySuiteId(
  value,
  { allowZero = false, label = "identitySuiteId" } = {},
) {
  const normalized = BigInt(value);
  const minimum = allowZero ? 0n : 1n;
  if (normalized < minimum || normalized > UINT32_MAX) {
    throw new Error(`${label} must be ${allowZero ? "a" : "a nonzero"} uint32`);
  }
  return normalized;
}

export function computeNameField(fullName) {
  const domainBytes = new TextEncoder().encode(DOMAIN_NAME_PREHASH);
  const nameBytes = new TextEncoder().encode(canonicalizeFullName(fullName));
  const combined = new Uint8Array(domainBytes.length + nameBytes.length);
  combined.set(domainBytes);
  combined.set(nameBytes, domainBytes.length);
  return BigInt(ethers.keccak256(combined)) % SNARK_FIELD;
}

export function computeAtomicSuiteCommitment(identitySuiteId) {
  const suiteId = normalizeIdentitySuiteId(identitySuiteId, { allowZero: true });
  return poseidon4([DOMAIN_SUITE, suiteId, 0n, 0n]);
}

function normalizeUnsignedInteger(value, label, maximum) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
  const normalized = BigInt(value ?? 0);
  if (normalized < 0n || normalized > maximum) {
    throw new Error(`${label} must be an integer in [0, ${maximum}]`);
  }
  return normalized;
}

function normalizeBooleanBit(value, label) {
  const normalized = value ?? false;
  if (
    normalized !== false &&
    normalized !== true &&
    normalized !== 0 &&
    normalized !== 1 &&
    normalized !== 0n &&
    normalized !== 1n
  ) {
    throw new Error(`${label} must be boolean or 0/1`);
  }
  return normalized === true || normalized === 1 || normalized === 1n;
}

export function packBirthGenderField(input) {
  const birthYear = normalizeUnsignedInteger(input.birthYear, "birthYear", 65535n);
  const birthMonth = normalizeUnsignedInteger(input.birthMonth, "birthMonth", 12n);
  const birthDay = normalizeUnsignedInteger(input.birthDay, "birthDay", 31n);
  const gender = normalizeUnsignedInteger(input.gender, "gender", 255n);
  const isBirthBC = normalizeBooleanBit(input.isBirthBC, "isBirthBC");
  return (
    (birthYear << 25n) |
    (birthMonth << 17n) |
    (birthDay << 9n) |
    (gender << 1n) |
    (isBirthBC ? 1n : 0n)
  );
}

function normalizeCircuitPerson(person, { allowEmpty = false, label = "person" } = {}) {
  if (person === null || person === undefined) {
    if (!allowEmpty) throw new Error(`${label} is required`);
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

  const canonicalFullName = canonicalizeFullName(person.fullName);
  if (!canonicalFullName) throw new Error(`${label}.fullName must be a non-empty string`);
  if (person.derivedSecretField === undefined || person.derivedSecretField === null) {
    throw new Error(`${label}.derivedSecretField is required`);
  }

  const normalized = {
    canonicalFullName,
    nameField: computeNameField(canonicalFullName),
    derivedSecretField: normalizeFieldElement(
      person.derivedSecretField,
      `${label}.derivedSecretField`,
    ),
    isBirthBC: normalizeBooleanBit(person.isBirthBC, `${label}.isBirthBC`),
    birthYear: Number(normalizeUnsignedInteger(person.birthYear, `${label}.birthYear`, 65535n)),
    birthMonth: Number(normalizeUnsignedInteger(person.birthMonth, `${label}.birthMonth`, 12n)),
    birthDay: Number(normalizeUnsignedInteger(person.birthDay, `${label}.birthDay`, 31n)),
    gender: Number(normalizeUnsignedInteger(person.gender, `${label}.gender`, 255n)),
  };
  packBirthGenderField(normalized);
  return normalized;
}

function computePersonIdentityCommitment(personFields, identitySuiteId) {
  const suiteId = normalizeIdentitySuiteId(identitySuiteId);
  const suiteCommitment = computeAtomicSuiteCommitment(suiteId);
  const nameSecretCommitment = poseidon4([
    DOMAIN_NAME_SECRET,
    personFields.nameField,
    personFields.derivedSecretField,
    suiteCommitment,
  ]);
  const packedBirthGenderField = packBirthGenderField(personFields);
  const identityCommitment = poseidon4([
    DOMAIN_IDENTITY,
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  ]);
  const personHash = ethers.keccak256(`0x${identityCommitment.toString(16).padStart(64, "0")}`);
  return {
    ...personFields,
    identitySuiteId: suiteId,
    suiteCommitment,
    nameSecretCommitment,
    packedBirthGenderField,
    identityCommitment,
    personHash,
  };
}

function normalizeDigestLimb(value, label) {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > UINT128_MAX) {
    throw new Error(`${label} must be a uint128`);
  }
  return normalized;
}

export function splitContentDigest(contentDigest) {
  const hex = typeof contentDigest === "string" ? contentDigest : ethers.hexlify(contentDigest);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(hex)) {
    throw new Error("contentDigest must be exactly 32 bytes");
  }
  const digest = BigInt(hex);
  return Object.freeze({
    contentDigestLo: digest & UINT128_MAX,
    contentDigestHi: digest >> 128n,
  });
}

function resolveContentDigestLimbs(opts) {
  if (opts.contentDigest !== undefined) {
    if (opts.contentDigestLo !== undefined || opts.contentDigestHi !== undefined) {
      throw new Error("Provide contentDigest or contentDigestLo/contentDigestHi, not both");
    }
    return splitContentDigest(opts.contentDigest);
  }
  if (opts.contentDigestLo === undefined || opts.contentDigestHi === undefined) {
    throw new Error("contentDigest or both contentDigestLo/contentDigestHi are required");
  }
  return Object.freeze({
    contentDigestLo: normalizeDigestLimb(opts.contentDigestLo, "contentDigestLo"),
    contentDigestHi: normalizeDigestLimb(opts.contentDigestHi, "contentDigestHi"),
  });
}

function resolveCircuitId(opts) {
  const expected = PERSON_RELATION_PROOF_DESCRIPTOR.circuitId;
  if (opts.circuitId !== undefined && Number(opts.circuitId) !== expected) {
    throw new Error(
      `Person relation descriptor is bound to circuitId ${expected}, got ${opts.circuitId}`,
    );
  }
  return expected;
}

function normalizeSignals(publicSignals) {
  return normalizePublicSignalsForSpec(publicSignals, PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC, {
    label: "Person relation",
  });
}

function assertSignalMatches(fieldName, actual, expected) {
  const normalizedExpected = BigInt(expected);
  if (actual !== normalizedExpected) {
    throw new Error(
      `Person relation ${fieldName} public signal mismatch ` +
        `(expected ${normalizedExpected}, got ${actual})`,
    );
  }
}

export function assertPersonRelationPublicSignalsMatch(built, publicSignals) {
  const normalizedSignals = normalizeSignals(publicSignals);
  const decoded = decodePersonRelationPublicSignals(normalizedSignals);
  const expected = {
    identityCommitment: built.person.identityCommitment,
    fatherIdentityCommitment: built.father?.identityCommitment ?? 0n,
    motherIdentityCommitment: built.mother?.identityCommitment ?? 0n,
    submitterAndSelfSuiteId: built.submitterAndSelfSuiteId,
    versionCommitment: built.versionCommitment,
  };

  for (const fieldName of PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder) {
    assertSignalMatches(fieldName, decoded[fieldName], expected[fieldName]);
  }
  return decoded;
}

export function computePersonHashFromInput(person, opts = {}) {
  const fields = normalizeCircuitPerson(person);
  const selfSuiteId = normalizeIdentitySuiteId(
    opts.selfSuiteId ?? person.identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
    { label: "selfSuiteId" },
  );
  return computePersonIdentityCommitment(fields, selfSuiteId);
}

export function buildPersonRelationInput(person, father, mother, submitterAddress, opts = {}) {
  const personFields = normalizeCircuitPerson(person);
  const fatherFields = normalizeCircuitPerson(father, { allowEmpty: true, label: "father" });
  const motherFields = normalizeCircuitPerson(mother, { allowEmpty: true, label: "mother" });
  const hasFather = father === null || father === undefined ? 0 : 1;
  const hasMother = mother === null || mother === undefined ? 0 : 1;

  const selfSuiteId = normalizeIdentitySuiteId(
    opts.selfSuiteId ?? person.identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
    { label: "selfSuiteId" },
  );
  const fatherSuiteId = hasFather
    ? normalizeIdentitySuiteId(
        opts.fatherSuiteId ?? father.identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
        { label: "fatherSuiteId" },
      )
    : 0n;
  const motherSuiteId = hasMother
    ? normalizeIdentitySuiteId(
        opts.motherSuiteId ?? mother.identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
        { label: "motherSuiteId" },
      )
    : 0n;
  const submitter = BigInt(normalizeAddressDecimal(submitterAddress, "submitter"));
  if (submitter > UINT160_MAX) {
    throw new Error("submitter must be a uint160 address value");
  }
  const { contentDigestLo, contentDigestHi } = resolveContentDigestLimbs(opts);

  const personCommitment = computePersonIdentityCommitment(personFields, selfSuiteId);
  const fatherCommitment = hasFather
    ? computePersonIdentityCommitment(fatherFields, fatherSuiteId)
    : null;
  const motherCommitment = hasMother
    ? computePersonIdentityCommitment(motherFields, motherSuiteId)
    : null;
  const submitterAndSelfSuiteId = submitter + (selfSuiteId << 160n);
  const versionCommitment = poseidon4([
    DOMAIN_VERSION_COMMITMENT,
    personFields.derivedSecretField,
    contentDigestLo,
    contentDigestHi,
  ]);

  const input = {
    nameField: personFields.nameField.toString(),
    derivedSecretField: personFields.derivedSecretField.toString(),
    isBirthBC: personFields.isBirthBC ? 1 : 0,
    birthYear: personFields.birthYear,
    birthMonth: personFields.birthMonth,
    birthDay: personFields.birthDay,
    gender: personFields.gender,
    selfSuiteId: selfSuiteId.toString(),
    fatherNameField: fatherFields.nameField.toString(),
    fatherDerivedSecretField: fatherFields.derivedSecretField.toString(),
    fatherIsBirthBC: fatherFields.isBirthBC ? 1 : 0,
    fatherBirthYear: fatherFields.birthYear,
    fatherBirthMonth: fatherFields.birthMonth,
    fatherBirthDay: fatherFields.birthDay,
    fatherGender: fatherFields.gender,
    fatherSuiteId: fatherSuiteId.toString(),
    motherNameField: motherFields.nameField.toString(),
    motherDerivedSecretField: motherFields.derivedSecretField.toString(),
    motherIsBirthBC: motherFields.isBirthBC ? 1 : 0,
    motherBirthYear: motherFields.birthYear,
    motherBirthMonth: motherFields.birthMonth,
    motherBirthDay: motherFields.birthDay,
    motherGender: motherFields.gender,
    motherSuiteId: motherSuiteId.toString(),
    hasFather,
    hasMother,
    submitter: submitter.toString(),
    contentDigestLo: contentDigestLo.toString(),
    contentDigestHi: contentDigestHi.toString(),
  };

  return {
    input,
    circuitId: resolveCircuitId(opts),
    proofEncodingId: PERSON_RELATION_PROOF_DESCRIPTOR.proofEncodingId,
    submitter,
    selfSuiteId,
    fatherSuiteId,
    motherSuiteId,
    submitterAndSelfSuiteId,
    contentDigestLo,
    contentDigestHi,
    versionCommitment,
    person: personCommitment,
    father: fatherCommitment,
    mother: motherCommitment,
    descriptor: PERSON_RELATION_PROOF_DESCRIPTOR,
  };
}

export async function generatePersonRelationProof(
  person,
  father,
  mother,
  submitterAddress,
  opts = {},
) {
  const built = buildPersonRelationInput(person, father, mother, submitterAddress, opts);
  const wasmPath = resolveArtifactFile(
    "Person relation circuit wasm",
    opts.wasm,
    DEFAULT_WASM_CANDIDATES,
  );
  const zkeyPath = resolveArtifactFile(
    "Person relation circuit zkey",
    opts.zkey,
    DEFAULT_ZKEY_CANDIDATES,
  );

  if (PERSON_RELATION_PROOF_DESCRIPTOR.proverDriver !== "snarkjs-groth16") {
    throw new Error(`Unsupported prover driver: ${PERSON_RELATION_PROOF_DESCRIPTOR.proverDriver}`);
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    built.input,
    wasmPath,
    zkeyPath,
    undefined,
    undefined,
    { singleThread: true },
  );
  const normalizedProof = normalizeGroth16Proof(proof);
  const normalizedSignals = normalizeSignals(publicSignals);
  const publicSignalsStruct = assertPersonRelationPublicSignalsMatch(built, normalizedSignals);

  return {
    ...built,
    proof: normalizedProof,
    publicSignals: normalizedSignals,
    publicSignalsStruct,
    proofEnvelope: formatProofEnvelope(normalizedProof, {
      circuitId: built.circuitId,
      proofEncodingId: built.proofEncodingId,
    }),
    artifacts: { wasm: wasmPath, zkey: zkeyPath },
    descriptor: PERSON_RELATION_PROOF_DESCRIPTOR,
  };
}

export default {
  assertPersonRelationPublicSignalsMatch,
  buildPersonRelationInput,
  computePersonHashFromInput,
  generatePersonRelationProof,
  splitContentDigest,
};
