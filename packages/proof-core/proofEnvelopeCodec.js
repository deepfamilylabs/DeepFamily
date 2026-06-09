export const PROOF_SYSTEM_ID_GROTH16_BN254_V1 = 1;
export const PROOF_ENCODING_ID_ABI_GROTH16_ABC = 1;
export const DEFAULT_PROOF_SYSTEM_ID = PROOF_SYSTEM_ID_GROTH16_BN254_V1;
export const DEFAULT_PROOF_ENCODING_ID = PROOF_ENCODING_ID_ABI_GROTH16_ABC;

const UINT256_MAX = (1n << 256n) - 1n;

function encodeUint256Word(value) {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > UINT256_MAX) {
    throw new Error(`Value is outside uint256 range: ${value}`);
  }
  return normalized.toString(16).padStart(64, "0");
}

function isPair(value) {
  return Array.isArray(value) && value.length === 2;
}

function hasAtLeastTwoCoordinates(value) {
  return Array.isArray(value) && value.length >= 2;
}

// Snarkjs emits BN254 G2 coordinates as [x0, x1] / [y0, y1], but Solidity
// Groth16 verifier templates consume them swapped. a / c have no inner
// ambiguity. This is the single implementation site for the swap.
export function normalizeGroth16Proof(proof) {
  if (
    !proof ||
    !hasAtLeastTwoCoordinates(proof.pi_a) ||
    !hasAtLeastTwoCoordinates(proof.pi_b) ||
    !hasAtLeastTwoCoordinates(proof.pi_b[0]) ||
    !hasAtLeastTwoCoordinates(proof.pi_b[1]) ||
    !hasAtLeastTwoCoordinates(proof.pi_c)
  ) {
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
  if (
    !abcProof ||
    !isPair(abcProof.a) ||
    !isPair(abcProof.b) ||
    !isPair(abcProof.b[0]) ||
    !isPair(abcProof.b[1]) ||
    !isPair(abcProof.c)
  ) {
    throw new Error("Groth16 proof must contain a/b/c components");
  }
  // These fixed-size arrays are eight consecutive uint256 ABI words.
  const words = [
    abcProof.a[0],
    abcProof.a[1],
    abcProof.b[0][0],
    abcProof.b[0][1],
    abcProof.b[1][0],
    abcProof.b[1][1],
    abcProof.c[0],
    abcProof.c[1],
  ];
  return `0x${words.map(encodeUint256Word).join("")}`;
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
