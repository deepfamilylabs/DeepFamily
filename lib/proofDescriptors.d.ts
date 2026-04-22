export type ProofDescriptor = {
  readonly key: string;
  readonly purpose: string;
  readonly proofSystemId: number;
  readonly proofEncodingId: number;
  readonly backend: string;
  readonly publicSignalSpec: string;
  readonly files: {
    readonly browser: {
      readonly wasm: string;
      readonly zkey: string;
      readonly vkey: string;
    };
    readonly node: {
      readonly wasm: readonly string[];
      readonly zkey: readonly string[];
      readonly vkey: readonly string[];
    };
  };
  readonly proverDriver: string;
  readonly proofPacker: string;
};

export const PERSON_COMMITMENT_PROOF_DESCRIPTOR: ProofDescriptor;
export const DISCLOSURE_BINDING_PROOF_DESCRIPTOR: ProofDescriptor;
export const PROOF_DESCRIPTORS: Readonly<Record<string, ProofDescriptor>>;
export const PROOF_DESCRIPTORS_BY_PURPOSE: Readonly<Record<string, ProofDescriptor>>;

export function getProofDescriptor(key: string): ProofDescriptor;
export function getProofDescriptorByPurpose(purpose: string): ProofDescriptor;
