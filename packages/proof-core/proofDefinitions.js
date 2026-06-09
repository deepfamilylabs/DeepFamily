import { DEFAULT_PROOF_ENCODING_ID, DEFAULT_PROOF_SYSTEM_ID } from "./proofEnvelopeCodec.js";
import {
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
} from "./publicSignalSpecs.js";

function defineProofDefinition({ key, purpose, publicSignalSpec }) {
  return Object.freeze({
    key,
    purpose,
    proofSystemId: DEFAULT_PROOF_SYSTEM_ID,
    proofEncodingId: DEFAULT_PROOF_ENCODING_ID,
    backend: "groth16-bn254",
    publicSignalSpec: publicSignalSpec.name,
    proverDriver: "snarkjs-groth16",
    proofPacker: "abi-groth16-abc",
  });
}

export const PERSON_COMMITMENT_PROOF_DEFINITION = defineProofDefinition({
  key: "person-commitment-groth16-bn254-v1",
  purpose: "PersonCommitment",
  publicSignalSpec: PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
});

export const DISCLOSURE_BINDING_PROOF_DEFINITION = defineProofDefinition({
  key: "disclosure-binding-groth16-bn254-v1",
  purpose: "DisclosureBinding",
  publicSignalSpec: DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
});

export const PROOF_DEFINITIONS = Object.freeze({
  [PERSON_COMMITMENT_PROOF_DEFINITION.key]: PERSON_COMMITMENT_PROOF_DEFINITION,
  [DISCLOSURE_BINDING_PROOF_DEFINITION.key]: DISCLOSURE_BINDING_PROOF_DEFINITION,
});

export const PROOF_DEFINITIONS_BY_PURPOSE = Object.freeze({
  [PERSON_COMMITMENT_PROOF_DEFINITION.purpose]: PERSON_COMMITMENT_PROOF_DEFINITION,
  [DISCLOSURE_BINDING_PROOF_DEFINITION.purpose]: DISCLOSURE_BINDING_PROOF_DEFINITION,
});

export function getProofDefinition(key) {
  const definition = PROOF_DEFINITIONS[key];
  if (!definition) {
    throw new Error(`Unknown proof definition: ${key}`);
  }
  return definition;
}

export function getProofDefinitionByPurpose(purpose) {
  const definition = PROOF_DEFINITIONS_BY_PURPOSE[purpose];
  if (!definition) {
    throw new Error(`Unknown proof definition purpose: ${purpose}`);
  }
  return definition;
}
