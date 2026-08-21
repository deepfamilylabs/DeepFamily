import {
  DISCLOSURE_BINDING_PROOF_DEFINITION,
  PERSON_RELATION_PROOF_DEFINITION,
  type ProofDefinition,
} from "@deepfamily/proof-core";

type BrowserProofFiles = {
  readonly wasm: string;
  readonly zkey: string;
  readonly vkey: string;
};

export type ProofDescriptor = ProofDefinition & {
  readonly files: {
    readonly browser: BrowserProofFiles;
  };
};

function defineBrowserDescriptor(
  definition: ProofDefinition,
  browserFiles: BrowserProofFiles,
): ProofDescriptor {
  return Object.freeze({
    ...definition,
    files: Object.freeze({
      browser: Object.freeze(browserFiles),
    }),
  });
}

export const PERSON_RELATION_PROOF_DESCRIPTOR = defineBrowserDescriptor(
  PERSON_RELATION_PROOF_DEFINITION,
  {
    wasm: "/zk/person_commitment.wasm",
    zkey: "/zk/person_commitment_final.zkey",
    vkey: "/zk/person_commitment.vkey.json",
  },
);

export const DISCLOSURE_BINDING_PROOF_DESCRIPTOR = defineBrowserDescriptor(
  DISCLOSURE_BINDING_PROOF_DEFINITION,
  {
    wasm: "/zk/disclosure_binding.wasm",
    zkey: "/zk/disclosure_binding_final.zkey",
    vkey: "/zk/disclosure_binding.vkey.json",
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

export function getProofDescriptor(key: string): ProofDescriptor {
  const descriptor = PROOF_DESCRIPTORS[key];
  if (!descriptor) {
    throw new Error(`Unknown proof descriptor: ${key}`);
  }
  return descriptor;
}

export function getProofDescriptorByPurpose(purpose: string): ProofDescriptor {
  const descriptor = PROOF_DESCRIPTORS_BY_PURPOSE[purpose];
  if (!descriptor) {
    throw new Error(`Unknown proof descriptor purpose: ${purpose}`);
  }
  return descriptor;
}
