// ZK proof generation / verification via snarkjs.
// Uses person_commitment and disclosure_binding circuits.

import type { Groth16Proof, PersonData } from "./zk";
import {
  computeNameField,
  computeSuiteCommitment,
  packBirthGenderField,
  computeNameSecretCommitment,
  computeIdentityCommitment,
  computeDisclosureBinding,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_CRYPTO_SUITE_VERSION,
  DEFAULT_HASH_ALGO_ID,
  SNARK_FIELD,
} from "./zk";
import { canonicalizeFullName } from "../crypto/identityCommitment";
// @ts-ignore
import * as snarkjs from "snarkjs";

type ZkArtifacts = {
  wasm: Uint8Array;
  zkey: Uint8Array;
};

let personCommitmentArtifactsPromise: Promise<ZkArtifacts> | null = null;
let disclosureBindingArtifactsPromise: Promise<ZkArtifacts> | null = null;
let personCommitmentVkeyPromise: Promise<any> | null = null;
let disclosureBindingVkeyPromise: Promise<any> | null = null;

async function loadArtifacts(wasmUrl: string, zkeyUrl: string): Promise<ZkArtifacts> {
  const [wasmRes, zkeyRes] = await Promise.all([fetch(wasmUrl), fetch(zkeyUrl)]);
  if (!wasmRes.ok) throw new Error(`Failed to load wasm from ${wasmUrl}: ${wasmRes.status}`);
  if (!zkeyRes.ok) throw new Error(`Failed to load zkey from ${zkeyUrl}: ${zkeyRes.status}`);
  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    wasmRes.arrayBuffer(),
    zkeyRes.arrayBuffer(),
  ]);
  return { wasm: new Uint8Array(wasmBuffer), zkey: new Uint8Array(zkeyBuffer) };
}

async function loadJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load json from ${url}: ${res.status}`);
  return await res.json();
}

async function loadPersonCommitmentArtifacts(): Promise<ZkArtifacts> {
  if (!personCommitmentArtifactsPromise) {
    personCommitmentArtifactsPromise = (async () => {
      try {
        return await loadArtifacts(
          "/zk/person_commitment.wasm",
          "/zk/person_commitment_final.zkey",
        );
      } catch (error) {
        personCommitmentArtifactsPromise = null;
        throw error;
      }
    })();
  }
  return personCommitmentArtifactsPromise;
}

async function loadDisclosureBindingArtifacts(): Promise<ZkArtifacts> {
  if (!disclosureBindingArtifactsPromise) {
    disclosureBindingArtifactsPromise = (async () => {
      try {
        return await loadArtifacts(
          "/zk/disclosure_binding.wasm",
          "/zk/disclosure_binding_final.zkey",
        );
      } catch (error) {
        disclosureBindingArtifactsPromise = null;
        throw error;
      }
    })();
  }
  return disclosureBindingArtifactsPromise;
}

async function loadPersonCommitmentVkey(): Promise<any> {
  if (!personCommitmentVkeyPromise) {
    personCommitmentVkeyPromise = (async () => {
      try {
        return await loadJson("/zk/person_commitment.vkey.json");
      } catch (error) {
        personCommitmentVkeyPromise = null;
        throw error;
      }
    })();
  }
  return personCommitmentVkeyPromise;
}

async function loadDisclosureBindingVkey(): Promise<any> {
  if (!disclosureBindingVkeyPromise) {
    disclosureBindingVkeyPromise = (async () => {
      try {
        return await loadJson("/zk/disclosure_binding.vkey.json");
      } catch (error) {
        disclosureBindingVkeyPromise = null;
        throw error;
      }
    })();
  }
  return disclosureBindingVkeyPromise;
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

  const { wasm, zkey } = await loadPersonCommitmentArtifacts();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  return { proof, publicSignals };
}

export async function verifyPersonCommitmentProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  const vKey = await loadPersonCommitmentVkey();
  return await snarkjs.groth16.verify(vKey, publicSignals, proof);
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

  const { wasm, zkey } = await loadDisclosureBindingArtifacts();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  return { proof, publicSignals };
}

export async function verifyDisclosureBindingProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  const vKey = await loadDisclosureBindingVkey();
  return await snarkjs.groth16.verify(vKey, publicSignals, proof);
}
