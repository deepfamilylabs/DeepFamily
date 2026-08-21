import path from "node:path";
import { fileURLToPath } from "node:url";
import { poseidon4 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import {
  formatProofEnvelope,
  normalizeAddressDecimal,
  normalizeGroth16Proof,
  resolveArtifactFile,
  resolveDescriptorNodeArtifactCandidates,
} from "./proofCommon.js";
import { DISCLOSURE_BINDING_PROOF_DESCRIPTOR } from "./proofDescriptors.js";
import {
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  decodeDisclosureBindingPublicSignals,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";
import {
  DEFAULT_IDENTITY_SUITE_ID,
  computePersonHashFromInput,
  normalizeIdentitySuiteId,
} from "./personCommitmentProof.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

function normalizeSignals(publicSignals) {
  return normalizePublicSignalsForSpec(publicSignals, DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC, {
    label: "Disclosure binding",
  });
}

function assertSignalMatches(fieldName, actual, expected) {
  const normalizedExpected = BigInt(expected);
  if (actual !== normalizedExpected) {
    throw new Error(
      `Disclosure binding ${fieldName} public signal mismatch ` +
        `(expected ${normalizedExpected}, got ${actual})`,
    );
  }
}

export function assertDisclosureBindingPublicSignalsMatch(built, publicSignals) {
  const normalizedSignals = normalizeSignals(publicSignals);
  const decoded = decodeDisclosureBindingPublicSignals(normalizedSignals);
  const expected = {
    identityCommitment: built.person.identityCommitment,
    disclosureBinding: built.disclosureBinding,
    minter: built.minter,
    suiteCommitment: built.suiteCommitment,
  };

  for (const fieldName of DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder) {
    assertSignalMatches(fieldName, decoded[fieldName], expected[fieldName]);
  }
  return decoded;
}

function resolveCircuitId(opts) {
  const expected = DISCLOSURE_BINDING_PROOF_DESCRIPTOR.circuitId;
  if (opts.circuitId !== undefined && Number(opts.circuitId) !== expected) {
    throw new Error(
      `Disclosure binding descriptor is bound to circuitId ${expected}, got ${opts.circuitId}`,
    );
  }
  return expected;
}

export function buildDisclosureBindingInput(person, minterAddress, opts = {}) {
  const selfSuiteId = normalizeIdentitySuiteId(
    opts.selfSuiteId ?? person?.identitySuiteId ?? DEFAULT_IDENTITY_SUITE_ID,
    { label: "selfSuiteId" },
  );
  const minter = BigInt(normalizeAddressDecimal(minterAddress, "minter"));
  if (minter < 0n || minter >= 1n << 160n) {
    throw new Error("minter must be a uint160 address value");
  }
  const personIdentity = computePersonHashFromInput(person, { selfSuiteId });
  const canonicalFullName = personIdentity.canonicalFullName;
  const derivedSecretField = personIdentity.derivedSecretField;
  const nameField = personIdentity.nameField;
  const packedBirthGenderField = personIdentity.packedBirthGenderField;
  const suiteCommitment = personIdentity.suiteCommitment;
  const identityCommitment = personIdentity.identityCommitment;
  const disclosureBinding = poseidon4([
    DOMAIN_DISCLOSURE,
    nameField,
    packedBirthGenderField,
    suiteCommitment,
  ]);
  return {
    input: {
      nameField: nameField.toString(),
      derivedSecretField: derivedSecretField.toString(),
      packedBirthGenderField: packedBirthGenderField.toString(),
      minter: minter.toString(),
      selfSuiteId: selfSuiteId.toString(),
    },
    circuitId: resolveCircuitId(opts),
    proofEncodingId: DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proofEncodingId,
    selfSuiteId,
    minter,
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
  const publicSignalsStruct = assertDisclosureBindingPublicSignalsMatch(built, normalizedSignals);

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
    descriptor: DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  };
}

export default {
  assertDisclosureBindingPublicSignalsMatch,
  buildDisclosureBindingInput,
  generateDisclosureBindingProof,
};
