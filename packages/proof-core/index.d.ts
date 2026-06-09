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

export type PublicSignalSpec = {
  readonly name: string;
  readonly version: number;
  readonly purpose: string;
  readonly fieldOrder: readonly string[];
  readonly length: number;
};

export type PublicSignalValue = string | number | bigint;
export type PublicSignalFieldTransform = (value: bigint, index: number) => unknown;
export type DecodePublicSignalsOptions = {
  readonly label?: string;
  readonly fieldTransforms?: Readonly<Record<string, PublicSignalFieldTransform>>;
};

export const PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC: PublicSignalSpec;
export const DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC: PublicSignalSpec;
export const PUBLIC_SIGNAL_SPECS: Readonly<Record<string, PublicSignalSpec>>;
export const PUBLIC_SIGNAL_SPECS_BY_PURPOSE: Readonly<Record<string, PublicSignalSpec>>;

export function normalizePublicSignalsForSpec(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  spec: PublicSignalSpec,
  opts?: { readonly label?: string },
): bigint[];
export function decodePublicSignals(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  spec: PublicSignalSpec,
  opts?: DecodePublicSignalsOptions,
): Record<string, unknown>;
export function getPublicSignalSpec(name: string): PublicSignalSpec;
export function getPublicSignalSpecByPurpose(purpose: string): PublicSignalSpec;
export function decodePersonCommitmentPublicSignals(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  opts?: DecodePublicSignalsOptions,
): Record<string, unknown>;
export function decodeDisclosureBindingPublicSignals(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  opts?: DecodePublicSignalsOptions,
): Record<string, unknown>;

export type ProofDefinition = {
  readonly key: string;
  readonly purpose: string;
  readonly proofSystemId: number;
  readonly proofEncodingId: number;
  readonly backend: string;
  readonly publicSignalSpec: string;
  readonly proverDriver: string;
  readonly proofPacker: string;
};

export const PERSON_COMMITMENT_PROOF_DEFINITION: ProofDefinition;
export const DISCLOSURE_BINDING_PROOF_DEFINITION: ProofDefinition;
export const PROOF_DEFINITIONS: Readonly<Record<string, ProofDefinition>>;
export const PROOF_DEFINITIONS_BY_PURPOSE: Readonly<Record<string, ProofDefinition>>;

export function getProofDefinition(key: string): ProofDefinition;
export function getProofDefinitionByPurpose(purpose: string): ProofDefinition;
