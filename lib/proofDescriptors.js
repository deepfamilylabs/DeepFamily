import {
  DEFAULT_PROOF_ENCODING_ID,
  DEFAULT_PROOF_SYSTEM_ID,
} from "./proofEnvelopeCodec.js";
import {
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
} from "./publicSignalSpecs.js";

function defineDescriptor({
  key,
  purpose,
  publicSignalSpec,
  browserFiles,
  nodeFiles,
}) {
  return Object.freeze({
    key,
    purpose,
    proofSystemId: DEFAULT_PROOF_SYSTEM_ID,
    proofEncodingId: DEFAULT_PROOF_ENCODING_ID,
    backend: "groth16-bn254",
    publicSignalSpec: publicSignalSpec.name,
    files: Object.freeze({
      browser: Object.freeze(browserFiles),
      node: Object.freeze({
        wasm: Object.freeze(nodeFiles.wasm),
        zkey: Object.freeze(nodeFiles.zkey),
        vkey: Object.freeze(nodeFiles.vkey),
      }),
    }),
    proverDriver: "snarkjs-groth16",
    proofPacker: "abi-groth16-abc",
  });
}

export const PERSON_COMMITMENT_PROOF_DESCRIPTOR = defineDescriptor({
  key: "person-commitment-groth16-bn254-v1",
  purpose: "PersonCommitment",
  publicSignalSpec: PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
  browserFiles: {
    wasm: "/zk/person_commitment.wasm",
    zkey: "/zk/person_commitment_final.zkey",
    vkey: "/zk/person_commitment.vkey.json",
  },
  nodeFiles: {
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
});

export const DISCLOSURE_BINDING_PROOF_DESCRIPTOR = defineDescriptor({
  key: "disclosure-binding-groth16-bn254-v1",
  purpose: "DisclosureBinding",
  publicSignalSpec: DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  browserFiles: {
    wasm: "/zk/disclosure_binding.wasm",
    zkey: "/zk/disclosure_binding_final.zkey",
    vkey: "/zk/disclosure_binding.vkey.json",
  },
  nodeFiles: {
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
});

export const PROOF_DESCRIPTORS = Object.freeze({
  [PERSON_COMMITMENT_PROOF_DESCRIPTOR.key]: PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  [DISCLOSURE_BINDING_PROOF_DESCRIPTOR.key]: DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
});

export const PROOF_DESCRIPTORS_BY_PURPOSE = Object.freeze({
  [PERSON_COMMITMENT_PROOF_DESCRIPTOR.purpose]: PERSON_COMMITMENT_PROOF_DESCRIPTOR,
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
