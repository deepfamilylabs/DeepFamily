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
import { DISCLOSURE_BINDING_PROOF_DESCRIPTOR } from "./proofDescriptors.js";
import {
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  decodeDisclosureBindingPublicSignals,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";
import { computePersonHashFromInput } from "./personCommitmentProof.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
const DOMAIN_SUITE = 1000n;
const DOMAIN_DISCLOSURE = 1003n;

const DEFAULT_WASM_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  "wasm",
);
const DEFAULT_ZKEY_CANDIDATES = resolveDescriptorNodeArtifactCandidates(
  __dirname,
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  "zkey",
);

function canonicalizeFullName(value) {
  if (value === undefined || value === null) return "";
  const normalized = typeof String(value).normalize === "function"
    ? String(value).normalize("NFKC")
    : String(value);
  return normalized.replace(/\s+/gu, " ").trim();
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

function packBirthGenderField(input) {
  return (
    (BigInt(input.birthYear ?? 0) << 24n) |
    (BigInt(input.birthMonth ?? 0) << 16n) |
    (BigInt(input.birthDay ?? 0) << 8n) |
    (BigInt(input.gender ?? 0) << 1n) |
    (input.isBirthBC ? 1n : 0n)
  );
}

function computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId) {
  return poseidon4([
    DOMAIN_SUITE,
    BigInt(schemaVersion),
    BigInt(cryptoSuiteVersion),
    BigInt(hashAlgoId),
  ]);
}

function normalizeSignals(publicSignals) {
  return normalizePublicSignalsForSpec(
    publicSignals,
    DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
    { label: "Disclosure binding" },
  );
}

export function buildDisclosureBindingInput(person, minterAddress, opts = {}) {
  const schemaVersion = opts.schemaVersion ?? person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion =
    opts.cryptoSuiteVersion ?? person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = opts.hashAlgoId ?? person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const proofSystemId =
    opts.proofSystemId ?? DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proofSystemId ?? DEFAULT_PROOF_SYSTEM_ID;
  const minter = normalizeAddressDecimal(minterAddress, "minter");
  const canonicalFullName = canonicalizeFullName(person.fullName);

  if (!canonicalFullName) {
    throw new Error("Full name must be a non-empty string");
  }

  const derivedSecretField = BigInt(person.derivedSecretField ?? 0n);
  const nameField = computeNameField(canonicalFullName);
  const packedBirthGenderField = packBirthGenderField(person);
  const suiteCommitment = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const disclosureBinding = poseidon4([
    DOMAIN_DISCLOSURE,
    nameField,
    packedBirthGenderField,
    suiteCommitment,
  ]);
  const personIdentity = computePersonHashFromInput(person, {
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  });

  return {
    input: {
      nameField: nameField.toString(),
      derivedSecretField: derivedSecretField.toString(),
      packedBirthGenderField: packedBirthGenderField.toString(),
      minter,
      schemaVersion,
      cryptoSuiteVersion,
      hashAlgoId,
    },
    proofSystemId,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
    canonicalFullName,
    disclosureBinding,
    suiteCommitment,
    nameField,
    packedBirthGenderField,
    person: personIdentity,
    descriptor: DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  };
}

export async function generateDisclosureBindingProof(person, minterAddress, opts = {}) {
  const built = buildDisclosureBindingInput(person, minterAddress, opts);
  const wasmPath = resolveArtifactFile(
    "Disclosure binding circuit wasm",
    opts.wasm,
    DEFAULT_WASM_CANDIDATES,
  );
  const zkeyPath = resolveArtifactFile(
    "Disclosure binding circuit zkey",
    opts.zkey,
    DEFAULT_ZKEY_CANDIDATES,
  );

  if (DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proverDriver !== "snarkjs-groth16") {
    throw new Error(
      `Unsupported prover driver: ${DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proverDriver}`,
    );
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, wasmPath, zkeyPath);
  const normalizedProof = normalizeGroth16Proof(proof);
  const normalizedSignals = normalizeSignals(publicSignals);

  return {
    ...built,
    proof: normalizedProof,
    publicSignals: normalizedSignals,
    publicSignalsStruct: decodeDisclosureBindingPublicSignals(normalizedSignals),
    proofEnvelope: formatProofEnvelope(normalizedProof, built),
    artifacts: {
      wasm: wasmPath,
      zkey: zkeyPath,
    },
    descriptor: DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  };
}

export default {
  buildDisclosureBindingInput,
  generateDisclosureBindingProof,
};
