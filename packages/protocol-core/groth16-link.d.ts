export type Groth16Field = bigint | string | number;
export type Groth16G1 = readonly Groth16Field[];
export type Groth16G2 = readonly (readonly Groth16Field[])[];
export interface Groth16VerificationKey {
  protocol: "groth16";
  curve: "bn128" | "bn254";
  nPublic: number;
  vk_alpha_1: Groth16G1;
  vk_beta_2: Groth16G2;
  vk_gamma_2: Groth16G2;
  vk_delta_2: Groth16G2;
  IC: readonly Groth16G1[];
}
export interface Groth16Proof {
  protocol: "groth16";
  curve: "bn128" | "bn254";
  pi_a: Groth16G1;
  pi_b: Groth16G2;
  pi_c: Groth16G1;
}
export interface LinkedGroth16Key {
  verificationKey: Groth16VerificationKey;
  deltaG1: Groth16G1;
}
export interface LinkedGroth16ProvingInput extends LinkedGroth16Key {
  proof: Groth16Proof;
}
export const LINKED_GROTH16_DOMAIN: string;
export const BN254_BASE_FIELD: bigint;
export const BN254_SCALAR_FIELD: bigint;
export function linkedGroth16VerificationKey(key: LinkedGroth16Key): {
  nPublic: number;
  deltaG1: bigint[];
  alpha: bigint[];
  beta: bigint[];
  gamma: bigint[];
  delta: bigint[];
  ic: bigint[][];
  words: bigint[];
  digest: string;
};
export function validateLinkedGroth16VerificationKey(
  key: LinkedGroth16Key,
): Promise<ReturnType<typeof linkedGroth16VerificationKey>>;
export function linkGroth16Proofs(input: {
  issuer: LinkedGroth16ProvingInput;
  presentation: LinkedGroth16ProvingInput;
  commonInputs: readonly Groth16Field[];
  publicInputs: readonly Groth16Field[];
}): Promise<string>;
export function verifyLinkedGroth16Proof(input: {
  proof: string;
  issuer: LinkedGroth16Key;
  presentation: LinkedGroth16Key;
  publicInputs: readonly Groth16Field[];
}): Promise<boolean>;
