import {
  DISCLOSURE_BINDING_PROOF_DEFINITION,
  PERSON_RELATION_PROOF_DEFINITION,
} from "@deepfamily/proof-core";

function defineNodeDescriptor(definition, nodeFiles) {
  return Object.freeze({
    ...definition,
    files: Object.freeze({
      node: Object.freeze({
        wasm: Object.freeze(nodeFiles.wasm),
        zkey: Object.freeze(nodeFiles.zkey),
        vkey: Object.freeze(nodeFiles.vkey),
      }),
    }),
  });
}

export const PERSON_RELATION_PROOF_DESCRIPTOR = defineNodeDescriptor(
  PERSON_RELATION_PROOF_DEFINITION,
  {
    wasm: [
      "frontend/public/zk/person_commitment.wasm",
      "zk-artifacts/circuits/person_commitment_js/person_commitment.wasm",
      "zk-artifacts/circuits/person_commitment.wasm",
      "artifacts/circuits/person_commitment_js/person_commitment.wasm",
      "artifacts/circuits/person_commitment.wasm",
    ],
    zkey: [
      "frontend/public/zk/person_commitment_final.zkey",
      "zk-artifacts/circuits/person_commitment_final.zkey",
      "artifacts/circuits/person_commitment_final.zkey",
    ],
    vkey: [
      "frontend/public/zk/person_commitment.vkey.json",
      "zk-artifacts/circuits/person_commitment.vkey.json",
    ],
  },
);

export const DISCLOSURE_BINDING_PROOF_DESCRIPTOR = defineNodeDescriptor(
  DISCLOSURE_BINDING_PROOF_DEFINITION,
  {
    wasm: [
      "frontend/public/zk/disclosure_binding.wasm",
      "zk-artifacts/circuits/disclosure_binding_js/disclosure_binding.wasm",
      "zk-artifacts/circuits/disclosure_binding.wasm",
      "artifacts/circuits/disclosure_binding_js/disclosure_binding.wasm",
      "artifacts/circuits/disclosure_binding.wasm",
    ],
    zkey: [
      "frontend/public/zk/disclosure_binding_final.zkey",
      "zk-artifacts/circuits/disclosure_binding_final.zkey",
      "artifacts/circuits/disclosure_binding_final.zkey",
    ],
    vkey: [
      "frontend/public/zk/disclosure_binding.vkey.json",
      "zk-artifacts/circuits/disclosure_binding.vkey.json",
    ],
  },
);

export const PROOF_DESCRIPTORS = Object.freeze({
  [PERSON_RELATION_PROOF_DESCRIPTOR.key]: PERSON_RELATION_PROOF_DESCRIPTOR,
  [DISCLOSURE_BINDING_PROOF_DESCRIPTOR.key]: DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
});

export const PROOF_DESCRIPTORS_BY_PURPOSE = Object.freeze({
  [PERSON_RELATION_PROOF_DESCRIPTOR.purpose]: PERSON_RELATION_PROOF_DESCRIPTOR,
  [DISCLOSURE_BINDING_PROOF_DESCRIPTOR.purpose]: DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
});

export function getProofDescriptor(key) {
  const descriptor = PROOF_DESCRIPTORS[key];
  if (!descriptor) {
    throw new Error(`Unknown proof descriptor: ${key}`);
  }
  return descriptor;
}

export function getProofDescriptorByPurpose(purpose) {
  const descriptor = PROOF_DESCRIPTORS_BY_PURPOSE[purpose];
  if (!descriptor) {
    throw new Error(`Unknown proof descriptor purpose: ${purpose}`);
  }
  return descriptor;
}
