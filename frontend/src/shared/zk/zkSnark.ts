// ZK proof generation / verification via snarkjs.
// Uses person_commitment and disclosure_binding circuits.

import type { Groth16Proof, PersonData } from "./zk";
import type { ProofDescriptor } from "./proofDescriptors";
import {
  computeNameField,
  computeSuiteCommitment,
  packBirthGenderField,
  computeNameSecretCommitment,
  computeIdentityCommitment,
  computeDisclosureBinding,
  computePersonHashFromData,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_CRYPTO_SUITE_VERSION,
  DEFAULT_HASH_ALGO_ID,
} from "./zk";
import {
  decodeDisclosureBindingPublicSignals,
  decodePersonCommitmentPublicSignals,
} from "./publicSignalSpecs";
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
} from "./proofDescriptors";
import { canonicalizeFullName } from "../crypto/identityCommitment";
// @ts-ignore
import * as snarkjs from "snarkjs";

type ZkArtifacts = {
  wasm: Uint8Array;
  zkey: Uint8Array;
};

const artifactPromiseCache = new Map<string, Promise<ZkArtifacts>>();
const vkeyPromiseCache = new Map<string, Promise<any>>();

async function loadArtifacts(wasmUrl: string, zkeyUrl: string): Promise<ZkArtifacts> {
  // Public ZK files intentionally keep stable paths during pre-release development. Always
  // revalidate them on a new page load so a browser cache cannot pair a newly deployed verifier
  // with stale proving artifacts. The in-memory descriptor cache still avoids duplicate downloads
  // within the same session.
  const [wasmRes, zkeyRes] = await Promise.all([
    fetch(wasmUrl, { cache: "no-cache" }),
    fetch(zkeyUrl, { cache: "no-cache" }),
  ]);
  if (!wasmRes.ok) throw new Error(`Failed to load wasm from ${wasmUrl}: ${wasmRes.status}`);
  if (!zkeyRes.ok) throw new Error(`Failed to load zkey from ${zkeyUrl}: ${zkeyRes.status}`);
  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    wasmRes.arrayBuffer(),
    zkeyRes.arrayBuffer(),
  ]);
  return { wasm: new Uint8Array(wasmBuffer), zkey: new Uint8Array(zkeyBuffer) };
}

async function loadJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load json from ${url}: ${res.status}`);
  return await res.json();
}

async function loadArtifactsForDescriptor(descriptor: ProofDescriptor): Promise<ZkArtifacts> {
  const cached = artifactPromiseCache.get(descriptor.key);
  if (cached) return cached;

  const promise = (async () => {
    try {
      return await loadArtifacts(descriptor.files.browser.wasm, descriptor.files.browser.zkey);
    } catch (error) {
      artifactPromiseCache.delete(descriptor.key);
      throw error;
    }
  })();

  artifactPromiseCache.set(descriptor.key, promise);
  return promise;
}

async function loadVerificationKeyForDescriptor(descriptor: ProofDescriptor): Promise<any> {
  const cached = vkeyPromiseCache.get(descriptor.key);
  if (cached) return cached;

  const promise = (async () => {
    try {
      return await loadJson(descriptor.files.browser.vkey);
    } catch (error) {
      vkeyPromiseCache.delete(descriptor.key);
      throw error;
    }
  })();

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
  const vKey = await loadVerificationKeyForDescriptor(descriptor);
  return await snarkjs.groth16.verify(vKey, publicSignals, proof);
}

function preparePersonField(person: PersonData | null): {
  nameField: string;
  derivedSecretField: string;
  isBirthBC: number;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: number;
} {
  if (!person || !person.fullName.trim()) {
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
  const canonical = canonicalizeFullName(person.fullName);
  return {
    nameField: computeNameField(canonical).toString(),
    derivedSecretField: person.derivedSecretField.toString(),
    isBirthBC: person.isBirthBC ? 1 : 0,
    birthYear: person.birthYear,
    birthMonth: person.birthMonth,
    birthDay: person.birthDay,
    gender: person.gender,
  };
}

function computeExpectedIdentityCommitment(person: PersonData, suiteCommitment: bigint): bigint {
  const nameField = computeNameField(canonicalizeFullName(person.fullName));
  const nameSecretCommitment = computeNameSecretCommitment(
    nameField,
    person.derivedSecretField,
    suiteCommitment,
  );
  return computeIdentityCommitment(
    nameSecretCommitment,
    packBirthGenderField(person),
    suiteCommitment,
  );
}

function assertSignalMatches(
  proofLabel: string,
  fieldName: string,
  actual: bigint | number,
  expected: bigint | number,
) {
  if (BigInt(actual) !== BigInt(expected)) {
    throw new Error(
      `${proofLabel} ${fieldName} public signal mismatch ` +
        `(expected ${expected}, got ${actual})`,
    );
  }
}

export function assertPersonCommitmentPublicSignalsMatch(
  publicSignals: ReadonlyArray<string | number | bigint>,
  person: PersonData,
  father: PersonData | null,
  mother: PersonData | null,
  submitterAddress: string,
) {
  const schemaVersion = person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion = person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const suiteCommitment = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const hasFather = Boolean(father && canonicalizeFullName(father.fullName).length > 0);
  const hasMother = Boolean(mother && canonicalizeFullName(mother.fullName).length > 0);
  const decoded = decodePersonCommitmentPublicSignals(publicSignals);
  const expected = {
    identityCommitment: computeExpectedIdentityCommitment(person, suiteCommitment),
    fatherIdentityCommitment:
      hasFather && father ? computeExpectedIdentityCommitment(father, suiteCommitment) : 0n,
    motherIdentityCommitment:
      hasMother && mother ? computeExpectedIdentityCommitment(mother, suiteCommitment) : 0n,
    submitter: BigInt(submitterAddress),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };

  for (const fieldName of Object.keys(expected) as Array<keyof typeof expected>) {
    assertSignalMatches("Person commitment", fieldName, decoded[fieldName], expected[fieldName]);
  }

  return decoded;
}

export function assertDisclosureBindingPublicSignalsMatch(
  publicSignals: ReadonlyArray<string | number | bigint>,
  person: PersonData,
  minterAddress: string,
) {
  const schemaVersion = person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion = person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const suiteCommitment = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const nameField = computeNameField(canonicalizeFullName(person.fullName));
  const packedBirthGenderField = packBirthGenderField(person);
  const decoded = decodeDisclosureBindingPublicSignals(publicSignals);
  const expected = {
    identityCommitment: computePersonHashFromData(person).identityCommitment,
    disclosureBinding: computeDisclosureBinding(nameField, packedBirthGenderField, suiteCommitment),
    minter: BigInt(minterAddress),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };

  for (const fieldName of Object.keys(expected) as Array<keyof typeof expected>) {
    assertSignalMatches("Disclosure binding", fieldName, decoded[fieldName], expected[fieldName]);
  }

  return decoded;
}

export async function generatePersonCommitmentProof(
  person: PersonData,
  father: PersonData | null,
  mother: PersonData | null,
  submitterAddress: string,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const schemaVersion = person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion = person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;

  const personFields = preparePersonField(person);
  const fatherFields = preparePersonField(father);
  const motherFields = preparePersonField(mother);

  const hasFather = father && canonicalizeFullName(father.fullName).length > 0 ? 1 : 0;
  const hasMother = mother && canonicalizeFullName(mother.fullName).length > 0 ? 1 : 0;

  const input = {
    nameField: personFields.nameField,
    derivedSecretField: personFields.derivedSecretField,
    isBirthBC: personFields.isBirthBC,
    birthYear: personFields.birthYear,
    birthMonth: personFields.birthMonth,
    birthDay: personFields.birthDay,
    gender: personFields.gender,
    fatherNameField: fatherFields.nameField,
    fatherDerivedSecretField: fatherFields.derivedSecretField,
    fatherIsBirthBC: fatherFields.isBirthBC,
    fatherBirthYear: fatherFields.birthYear,
    fatherBirthMonth: fatherFields.birthMonth,
    fatherBirthDay: fatherFields.birthDay,
    fatherGender: fatherFields.gender,
    motherNameField: motherFields.nameField,
    motherDerivedSecretField: motherFields.derivedSecretField,
    motherIsBirthBC: motherFields.isBirthBC,
    motherBirthYear: motherFields.birthYear,
    motherBirthMonth: motherFields.birthMonth,
    motherBirthDay: motherFields.birthDay,
    motherGender: motherFields.gender,
    hasFather,
    hasMother,
    submitter: BigInt(submitterAddress).toString(),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };

  const { proof, publicSignals } = await fullProveWithDescriptor(
    PERSON_COMMITMENT_PROOF_DESCRIPTOR,
    input,
  );
  assertPersonCommitmentPublicSignalsMatch(publicSignals, person, father, mother, submitterAddress);
  return { proof, publicSignals };
}

export async function verifyPersonCommitmentProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  return await verifyWithDescriptor(PERSON_COMMITMENT_PROOF_DESCRIPTOR, proof, publicSignals);
}

export async function generateDisclosureBindingProof(
  person: PersonData,
  minterAddress: string,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  if (!minterAddress || minterAddress.length === 0) {
    throw new Error("Minter address is required to generate the name disclosure proof");
  }

  const schemaVersion = person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion = person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;

  const canonical = canonicalizeFullName(person.fullName);
  const nameField = computeNameField(canonical);
  const packed = packBirthGenderField(person);

  const input = {
    nameField: nameField.toString(),
    derivedSecretField: person.derivedSecretField.toString(),
    packedBirthGenderField: packed.toString(),
    minter: BigInt(minterAddress).toString(),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };

  const { proof, publicSignals } = await fullProveWithDescriptor(
    DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
    input,
  );
  assertDisclosureBindingPublicSignalsMatch(publicSignals, person, minterAddress);
  return { proof, publicSignals };
}

export async function verifyDisclosureBindingProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  return await verifyWithDescriptor(DISCLOSURE_BINDING_PROOF_DESCRIPTOR, proof, publicSignals);
}
