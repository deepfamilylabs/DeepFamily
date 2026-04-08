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
  normalizeAddressDecimal,
  normalizeGroth16Proof,
  formatProofEnvelope,
} from "./proofCommon.js";
import { computePersonHashFromInput } from "./personCommitmentProof.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DOMAIN_NAME_PREHASH = "deepfamily:name-prehash:v2";
const DOMAIN_SUITE = 1000n;
const DOMAIN_DISCLOSURE = 1003n;

const DEFAULT_WASM_CANDIDATES = [
  path.join(__dirname, "../frontend/public/zk/disclosure_binding.wasm"),
  path.join(__dirname, "../zk-artifacts/circuits/disclosure_binding_js/disclosure_binding.wasm"),
  path.join(__dirname, "../zk-artifacts/circuits/disclosure_binding.wasm"),
  path.join(__dirname, "../artifacts/circuits/disclosure_binding_js/disclosure_binding.wasm"),
  path.join(__dirname, "../artifacts/circuits/disclosure_binding.wasm"),
];

const DEFAULT_ZKEY_CANDIDATES = [
  path.join(__dirname, "../frontend/public/zk/disclosure_binding_final.zkey"),
  path.join(__dirname, "../zk-artifacts/circuits/disclosure_binding_final.zkey"),
  path.join(__dirname, "../artifacts/circuits/disclosure_binding_final.zkey"),
];

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
  if (!Array.isArray(publicSignals) || publicSignals.length !== 6) {
    throw new Error(`Disclosure binding public signals length mismatch (expected 6, got ${publicSignals?.length})`);
  }
  return publicSignals.map((value) => BigInt(value));
}

export function buildDisclosureBindingInput(person, minterAddress, opts = {}) {
  const schemaVersion = opts.schemaVersion ?? person.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const cryptoSuiteVersion =
    opts.cryptoSuiteVersion ?? person.cryptoSuiteVersion ?? DEFAULT_CRYPTO_SUITE_VERSION;
  const hashAlgoId = opts.hashAlgoId ?? person.hashAlgoId ?? DEFAULT_HASH_ALGO_ID;
  const proofSystemId = opts.proofSystemId ?? DEFAULT_PROOF_SYSTEM_ID;
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

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, wasmPath, zkeyPath);
  const normalizedProof = normalizeGroth16Proof(proof);
  const normalizedSignals = normalizeSignals(publicSignals);

  return {
    ...built,
    proof: normalizedProof,
    publicSignals: normalizedSignals,
    publicSignalsStruct: {
      identityCommitment: normalizedSignals[0],
      disclosureBinding: normalizedSignals[1],
      minter: normalizedSignals[2],
      schemaVersion: normalizedSignals[3],
      cryptoSuiteVersion: normalizedSignals[4],
      hashAlgoId: normalizedSignals[5],
    },
    proofEnvelope: formatProofEnvelope(normalizedProof, built),
    artifacts: {
      wasm: wasmPath,
      zkey: zkeyPath,
    },
  };
}

export default {
  buildDisclosureBindingInput,
  generateDisclosureBindingProof,
};
