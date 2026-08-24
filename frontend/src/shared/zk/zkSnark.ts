// Fresh-v1 PersonRelation / DisclosureBinding proof generation and verification.

import { canonicalizeFullName } from "@deepfamily/protocol-core";
import type { Groth16Proof, PersonData } from "./zk";
import type { ProofDescriptor } from "./proofDescriptors";
import {
  SNARK_FIELD,
  computeDisclosureBinding,
  computePersonHashFromData,
  computeVersionCommitment,
  normalizeIdentitySuiteId,
} from "./zk";
import {
  decodeDisclosureBindingPublicSignals,
  decodePersonRelationPublicSignals,
} from "./publicSignalSpecs";
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_RELATION_PROOF_DESCRIPTOR,
} from "./proofDescriptors";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";

export type DigestLimb = string | bigint;

export type PersonRelationProofParameters = {
  person: PersonData;
  father: PersonData | null;
  mother: PersonData | null;
  submitterAddress: string;
  selfSuiteId: number;
  fatherSuiteId: number;
  motherSuiteId: number;
  contentDigestLo: DigestLimb;
  contentDigestHi: DigestLimb;
};

export type DisclosureBindingProofParameters = {
  person: PersonData;
  minterAddress: string;
  selfSuiteId: number;
};

type ZkArtifacts = {
  wasm: Uint8Array;
  zkey: Uint8Array;
};

const artifactPromiseCache = new Map<string, Promise<ZkArtifacts>>();
const vkeyPromiseCache = new Map<string, Promise<unknown>>();
const UINT160_MAX = (1n << 160n) - 1n;

async function loadArtifacts(wasmUrl: string, zkeyUrl: string): Promise<ZkArtifacts> {
  const [wasmResponse, zkeyResponse] = await Promise.all([
    fetch(wasmUrl, { cache: "no-cache" }),
    fetch(zkeyUrl, { cache: "no-cache" }),
  ]);
  if (!wasmResponse.ok) {
    throw new Error(`Failed to load wasm from ${wasmUrl}: ${wasmResponse.status}`);
  }
  if (!zkeyResponse.ok) {
    throw new Error(`Failed to load zkey from ${zkeyUrl}: ${zkeyResponse.status}`);
  }
  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    wasmResponse.arrayBuffer(),
    zkeyResponse.arrayBuffer(),
  ]);
  return { wasm: new Uint8Array(wasmBuffer), zkey: new Uint8Array(zkeyBuffer) };
}

async function loadJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Failed to load json from ${url}: ${response.status}`);
  return await response.json();
}

async function loadArtifactsForDescriptor(descriptor: ProofDescriptor): Promise<ZkArtifacts> {
  const cached = artifactPromiseCache.get(descriptor.key);
  if (cached) return cached;
  const promise = loadArtifacts(descriptor.files.browser.wasm, descriptor.files.browser.zkey).catch(
    (error) => {
      artifactPromiseCache.delete(descriptor.key);
      throw error;
    },
  );
  artifactPromiseCache.set(descriptor.key, promise);
  return promise;
}

async function loadVerificationKeyForDescriptor(descriptor: ProofDescriptor): Promise<unknown> {
  const cached = vkeyPromiseCache.get(descriptor.key);
  if (cached) return cached;
  const promise = loadJson(descriptor.files.browser.vkey).catch((error) => {
    vkeyPromiseCache.delete(descriptor.key);
    throw error;
  });
  vkeyPromiseCache.set(descriptor.key, promise);
  return promise;
}

function assertSupportedProverDriver(descriptor: ProofDescriptor) {
  if (descriptor.proverDriver !== "snarkjs-groth16") {
    throw new Error(`Unsupported prover driver: ${descriptor.proverDriver}`);
  }
}

async function fullProveWithDescriptor(
  descriptor: ProofDescriptor,
  input: Record<string, string | number>,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  assertSupportedProverDriver(descriptor);
  const { wasm, zkey } = await loadArtifactsForDescriptor(descriptor);
  return await snarkjs.groth16.fullProve(input, wasm, zkey);
}

async function verifyWithDescriptor(
  descriptor: ProofDescriptor,
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  assertSupportedProverDriver(descriptor);
  const verificationKey = await loadVerificationKeyForDescriptor(descriptor);
  return await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
}

function assertCanonicalPerson(person: PersonData, label: string) {
  if (!canonicalizeFullName(person.fullName)) throw new Error(`${label}.fullName is required`);
  if (person.derivedSecretField < 0n || person.derivedSecretField >= SNARK_FIELD) {
    throw new Error(`${label}.derivedSecretField must be a canonical BN254 field element`);
  }
}

function preparePersonField(person: PersonData | null, label: string) {
  if (person === null) {
    return {
      nameField: "0",
      derivedSecretField: "0",
      isBirthBC: 0,
      birthYear: 0,
      birthMonth: 0,
      birthDay: 0,
      gender: 0,
    };
  }
  assertCanonicalPerson(person, label);
  const identity = computePersonHashFromData(person, 1);
  return {
    nameField: identity.nameField.toString(),
    derivedSecretField: person.derivedSecretField.toString(),
    isBirthBC: person.isBirthBC ? 1 : 0,
    birthYear: person.birthYear,
    birthMonth: person.birthMonth,
    birthDay: person.birthDay,
    gender: person.gender,
  };
}

function normalizeRoleSuiteId(value: number, present: boolean, label: string): bigint {
  const suiteId = normalizeIdentitySuiteId(value, { allowZero: !present, label });
  if ((suiteId !== 0n) !== present) {
    throw new Error(`${label} must be nonzero exactly when its role is present`);
  }
  return suiteId;
}

function normalizeAddressField(value: string, label: string): bigint {
  if (!value) throw new Error(`${label} is required`);
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > UINT160_MAX) throw new Error(`${label} must be a uint160`);
  return normalized;
}

function assertSignalMatches(
  proofLabel: string,
  fieldName: string,
  actual: bigint,
  expected: bigint,
) {
  if (actual !== expected) {
    throw new Error(
      `${proofLabel} ${fieldName} public signal mismatch ` +
        `(expected ${expected}, got ${actual})`,
    );
  }
}

export function assertPersonRelationPublicSignalsMatch(
  publicSignals: ReadonlyArray<string | number | bigint>,
  parameters: PersonRelationProofParameters,
) {
  const selfSuiteId = normalizeIdentitySuiteId(parameters.selfSuiteId, { label: "selfSuiteId" });
  const fatherSuiteId = normalizeRoleSuiteId(
    parameters.fatherSuiteId,
    parameters.father !== null,
    "fatherSuiteId",
  );
  const motherSuiteId = normalizeRoleSuiteId(
    parameters.motherSuiteId,
    parameters.mother !== null,
    "motherSuiteId",
  );
  assertCanonicalPerson(parameters.person, "person");
  if (parameters.father) assertCanonicalPerson(parameters.father, "father");
  if (parameters.mother) assertCanonicalPerson(parameters.mother, "mother");
  const submitter = normalizeAddressField(parameters.submitterAddress, "submitterAddress");
  const decoded = decodePersonRelationPublicSignals(publicSignals);
  const expected = {
    identityCommitment: computePersonHashFromData(parameters.person, selfSuiteId)
      .identityCommitment,
    fatherIdentityCommitment: parameters.father
      ? computePersonHashFromData(parameters.father, fatherSuiteId).identityCommitment
      : 0n,
    motherIdentityCommitment: parameters.mother
      ? computePersonHashFromData(parameters.mother, motherSuiteId).identityCommitment
      : 0n,
    submitterAndSelfSuiteId: submitter + (selfSuiteId << 160n),
    versionCommitment: computeVersionCommitment(
      parameters.person.derivedSecretField,
      parameters.contentDigestLo,
      parameters.contentDigestHi,
    ),
  };
  for (const fieldName of Object.keys(expected) as Array<keyof typeof expected>) {
    assertSignalMatches("Person relation", fieldName, decoded[fieldName], expected[fieldName]);
  }
  return decoded;
}

export function assertDisclosureBindingPublicSignalsMatch(
  publicSignals: ReadonlyArray<string | number | bigint>,
  parameters: DisclosureBindingProofParameters,
) {
  assertCanonicalPerson(parameters.person, "person");
  const selfSuiteId = normalizeIdentitySuiteId(parameters.selfSuiteId, { label: "selfSuiteId" });
  const minter = normalizeAddressField(parameters.minterAddress, "minterAddress");
  const identity = computePersonHashFromData(parameters.person, selfSuiteId);
  const decoded = decodeDisclosureBindingPublicSignals(publicSignals);
  const expected = {
    identityCommitment: identity.identityCommitment,
    disclosureBinding: computeDisclosureBinding(
      identity.nameField,
      identity.packedBirthGenderField,
      identity.suiteCommitment,
    ),
    minter,
    suiteCommitment: identity.suiteCommitment,
  };
  for (const fieldName of Object.keys(expected) as Array<keyof typeof expected>) {
    assertSignalMatches("Disclosure binding", fieldName, decoded[fieldName], expected[fieldName]);
  }
  return decoded;
}

export async function generatePersonRelationProof(
  parameters: PersonRelationProofParameters,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const selfSuiteId = normalizeIdentitySuiteId(parameters.selfSuiteId, { label: "selfSuiteId" });
  const fatherSuiteId = normalizeRoleSuiteId(
    parameters.fatherSuiteId,
    parameters.father !== null,
    "fatherSuiteId",
  );
  const motherSuiteId = normalizeRoleSuiteId(
    parameters.motherSuiteId,
    parameters.mother !== null,
    "motherSuiteId",
  );
  const personFields = preparePersonField(parameters.person, "person");
  const fatherFields = preparePersonField(parameters.father, "father");
  const motherFields = preparePersonField(parameters.mother, "mother");
  const submitter = normalizeAddressField(parameters.submitterAddress, "submitterAddress");
  computeVersionCommitment(
    parameters.person.derivedSecretField,
    parameters.contentDigestLo,
    parameters.contentDigestHi,
  );

  const input = {
    ...personFields,
    selfSuiteId: selfSuiteId.toString(),
    fatherNameField: fatherFields.nameField,
    fatherDerivedSecretField: fatherFields.derivedSecretField,
    fatherIsBirthBC: fatherFields.isBirthBC,
    fatherBirthYear: fatherFields.birthYear,
    fatherBirthMonth: fatherFields.birthMonth,
    fatherBirthDay: fatherFields.birthDay,
    fatherGender: fatherFields.gender,
    fatherSuiteId: fatherSuiteId.toString(),
    motherNameField: motherFields.nameField,
    motherDerivedSecretField: motherFields.derivedSecretField,
    motherIsBirthBC: motherFields.isBirthBC,
    motherBirthYear: motherFields.birthYear,
    motherBirthMonth: motherFields.birthMonth,
    motherBirthDay: motherFields.birthDay,
    motherGender: motherFields.gender,
    motherSuiteId: motherSuiteId.toString(),
    hasFather: parameters.father === null ? 0 : 1,
    hasMother: parameters.mother === null ? 0 : 1,
    submitter: submitter.toString(),
    contentDigestLo: BigInt(parameters.contentDigestLo).toString(),
    contentDigestHi: BigInt(parameters.contentDigestHi).toString(),
  };
  const result = await fullProveWithDescriptor(PERSON_RELATION_PROOF_DESCRIPTOR, input);
  assertPersonRelationPublicSignalsMatch(result.publicSignals, parameters);
  return result;
}

export async function verifyPersonRelationProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  return await verifyWithDescriptor(PERSON_RELATION_PROOF_DESCRIPTOR, proof, publicSignals);
}

export async function generateDisclosureBindingProof(
  parameters: DisclosureBindingProofParameters,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  assertCanonicalPerson(parameters.person, "person");
  const selfSuiteId = normalizeIdentitySuiteId(parameters.selfSuiteId, { label: "selfSuiteId" });
  const minter = normalizeAddressField(parameters.minterAddress, "minterAddress");
  const identity = computePersonHashFromData(parameters.person, selfSuiteId);
  const input = {
    nameField: identity.nameField.toString(),
    derivedSecretField: parameters.person.derivedSecretField.toString(),
    packedBirthGenderField: identity.packedBirthGenderField.toString(),
    minter: minter.toString(),
    selfSuiteId: selfSuiteId.toString(),
  };
  const result = await fullProveWithDescriptor(DISCLOSURE_BINDING_PROOF_DESCRIPTOR, input);
  assertDisclosureBindingPublicSignalsMatch(result.publicSignals, parameters);
  return result;
}

export async function verifyDisclosureBindingProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  return await verifyWithDescriptor(DISCLOSURE_BINDING_PROOF_DESCRIPTOR, proof, publicSignals);
}
