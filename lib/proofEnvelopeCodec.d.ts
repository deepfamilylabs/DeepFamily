export const PROOF_SYSTEM_ID_GROTH16_BN254_V1: 1;
export const PROOF_ENCODING_ID_ABI_GROTH16_ABC: 1;
export const DEFAULT_PROOF_SYSTEM_ID: number;
export const DEFAULT_PROOF_ENCODING_ID: number;

export type Groth16AbcProof = {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
};

export type Groth16RawProof = {
  pi_a: Array<string | bigint>;
  pi_b: Array<Array<string | bigint>>;
  pi_c: Array<string | bigint>;
  protocol?: string;
  curve?: string;
};

export type ProofEnvelope = {
  proofSystemId: number;
  proofEncodingId: number;
  proofData: string;
};

export type ProofEnvelopeOpts = {
  proofSystemId?: number;
  proofEncodingId?: number;
};

export function normalizeGroth16Proof(proof: Groth16RawProof): Groth16AbcProof;
export function encodeGroth16AbcProofData(abcProof: Groth16AbcProof): string;
export function packGroth16ProofEnvelope(
  proof: Groth16RawProof | Groth16AbcProof,
  opts?: ProofEnvelopeOpts,
): ProofEnvelope;
