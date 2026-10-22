import { protocolAssert } from "./errors.js";

/** Proof coordinates are canonical elements of the BN254 base field. */
const BN254_BASE_FIELD =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function invalid(condition, message) {
  protocolAssert(condition, "INVALID_SHIELDED_RECEIVE_CODE", message);
}

function coordinate(value, label) {
  const result = BigInt(value);
  invalid(result >= 0n && result < BN254_BASE_FIELD, `${label} is not a canonical coordinate`);
  return result;
}

/**
 * Proof words, in snarkjs coordinate order: pi_a.x, pi_a.y, pi_b.x.c0,
 * pi_b.x.c1, pi_b.y.c0, pi_b.y.c1, pi_c.x, pi_c.y. The point at infinity
 * is never a valid proof element and is rejected before curve checks.
 */
export function receiveProofWords(proof) {
  invalid(
    proof?.pi_a?.length >= 2 && proof?.pi_b?.length >= 2 && proof?.pi_c?.length >= 2,
    "Receive code proof has the wrong shape",
  );
  const a = [proof.pi_a[0], proof.pi_a[1]].map((value) => coordinate(value, "pi_a"));
  const b = [proof.pi_b[0][0], proof.pi_b[0][1], proof.pi_b[1][0], proof.pi_b[1][1]].map((value) =>
    coordinate(value, "pi_b"),
  );
  const c = [proof.pi_c[0], proof.pi_c[1]].map((value) => coordinate(value, "pi_c"));
  if (proof.pi_a.length > 2) invalid(BigInt(proof.pi_a[2]) === 1n, "pi_a must be affine");
  if (proof.pi_c.length > 2) invalid(BigInt(proof.pi_c[2]) === 1n, "pi_c must be affine");
  if (proof.pi_b.length > 2) {
    invalid(
      BigInt(proof.pi_b[2][0]) === 1n && BigInt(proof.pi_b[2][1]) === 0n,
      "pi_b must be affine",
    );
  }
  invalid(a.some(Boolean) && c.some(Boolean) && b.some(Boolean), "Proof point is at infinity");
  return [...a, ...b, ...c];
}

export function receiveProofFromWords(words) {
  const text = words.map(String);
  return {
    pi_a: [text[0], text[1], "1"],
    pi_b: [
      [text[2], text[3]],
      [text[4], text[5]],
      ["1", "0"],
    ],
    pi_c: [text[6], text[7], "1"],
    protocol: "groth16",
    curve: "bn128",
  };
}
