import type { ProofDefinition } from "@deepfamily/proof-core";

export type ProofDescriptor = ProofDefinition & {
  readonly files: {
    readonly node: {
      readonly wasm: readonly string[];
      readonly zkey: readonly string[];
      readonly vkey: readonly string[];
    };
  };
};

export const PERSON_RELATION_PROOF_DESCRIPTOR: ProofDescriptor;
export const DISCLOSURE_BINDING_PROOF_DESCRIPTOR: ProofDescriptor;
export const PROOF_DESCRIPTORS: Readonly<Record<string, ProofDescriptor>>;
export const PROOF_DESCRIPTORS_BY_PURPOSE: Readonly<Record<string, ProofDescriptor>>;

export function getProofDescriptor(key: string): ProofDescriptor;
export function getProofDescriptorByPurpose(purpose: string): ProofDescriptor;
