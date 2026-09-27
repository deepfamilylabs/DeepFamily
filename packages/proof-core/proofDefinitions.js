import { PROOF_ENCODING_ID_ABI_GROTH16_ABC } from "./proofEnvelopeCodec.js";
import {
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
} from "./publicSignalSpecs.js";

export const PERSON_RELATION_CIRCUIT_ID_V1 = 1;
export const DISCLOSURE_BINDING_CIRCUIT_ID_V1 = 1;

function defineProofDefinition({ key, purpose, circuitId, publicSignalSpec }) {
  return Object.freeze({
    key,
    purpose,
    circuitId,
    proofEncodingId: PROOF_ENCODING_ID_ABI_GROTH16_ABC,
    backend: "groth16-bn254",
    publicSignalSpec: publicSignalSpec.name,
    proverDriver: "snarkjs-groth16",
    proofPacker: "abi-groth16-abc",
  });
}

export const PERSON_RELATION_PROOF_DEFINITION = defineProofDefinition({
  key: "person-relation-groth16-bn254-v1",
  purpose: "PersonRelation",
  circuitId: PERSON_RELATION_CIRCUIT_ID_V1,
  publicSignalSpec: PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
});

export const DISCLOSURE_BINDING_PROOF_DEFINITION = defineProofDefinition({
  key: "disclosure-binding-groth16-bn254-v1",
  purpose: "DisclosureBinding",
  circuitId: DISCLOSURE_BINDING_CIRCUIT_ID_V1,
  publicSignalSpec: DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
});

export const PROOF_DEFINITIONS = Object.freeze({
  [PERSON_RELATION_PROOF_DEFINITION.key]: PERSON_RELATION_PROOF_DEFINITION,
  [DISCLOSURE_BINDING_PROOF_DEFINITION.key]: DISCLOSURE_BINDING_PROOF_DEFINITION,
});

export const PROOF_DEFINITIONS_BY_PURPOSE = Object.freeze({
  [PERSON_RELATION_PROOF_DEFINITION.purpose]: PERSON_RELATION_PROOF_DEFINITION,
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
