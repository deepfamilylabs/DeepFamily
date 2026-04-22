import { AbiCoder } from "ethers";

export const PROOF_SYSTEM_ID_GROTH16_BN254_V1 = 1;
export const PROOF_ENCODING_ID_ABI_GROTH16_ABC = 1;
export const DEFAULT_PROOF_SYSTEM_ID = PROOF_SYSTEM_ID_GROTH16_BN254_V1;
export const DEFAULT_PROOF_ENCODING_ID = PROOF_ENCODING_ID_ABI_GROTH16_ABC;

const GROTH16_ABC_ABI_TYPES = ["uint256[2]", "uint256[2][2]", "uint256[2]"];

// Snarkjs emits BN254 G2 coordinates as [x0, x1] / [y0, y1], but Solidity
// Groth16 verifier templates consume them swapped. a / c have no inner
// ambiguity. This is the single implementation site for the swap.
export function normalizeGroth16Proof(proof) {
  if (!proof || !proof.pi_a || !proof.pi_b || !proof.pi_c) {
    throw new Error("Invalid Groth16 proof structure returned by snarkjs");
  }
  return {
    a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    b: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
  };
}

export function encodeGroth16AbcProofData(abcProof) {
  if (!abcProof || !abcProof.a || !abcProof.b || !abcProof.c) {
    throw new Error("Groth16 proof must contain a/b/c components");
  }
  return AbiCoder.defaultAbiCoder().encode(GROTH16_ABC_ABI_TYPES, [
    abcProof.a,
    abcProof.b,
    abcProof.c,
  ]);
}

export function packGroth16ProofEnvelope(proof, opts = {}) {
  const hasSnarkjs = Boolean(proof?.pi_a && proof?.pi_b && proof?.pi_c);
  const hasAbc = Boolean(proof?.a && proof?.b && proof?.c);
  if (!hasSnarkjs && !hasAbc) {
    throw new Error("packGroth16ProofEnvelope: proof must contain pi_a/pi_b/pi_c or a/b/c");
  }
  const abcProof = hasSnarkjs ? normalizeGroth16Proof(proof) : proof;
  return {
    proofSystemId: opts.proofSystemId ?? DEFAULT_PROOF_SYSTEM_ID,
    proofEncodingId: opts.proofEncodingId ?? DEFAULT_PROOF_ENCODING_ID,
    proofData: encodeGroth16AbcProofData(abcProof),
  };
}
