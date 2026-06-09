import { expect } from "chai";
import { AbiCoder } from "ethers";
import {
  encodeGroth16AbcProofData,
  normalizeGroth16Proof,
  packGroth16ProofEnvelope,
} from "@deepfamily/proof-core";

describe("proof envelope codec", () => {
  const abcProof = {
    a: [1n, 2n],
    b: [
      [3n, 4n],
      [5n, 6n],
    ],
    c: [7n, 8n],
  };
  const fixedAbiVector =
    "0x" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "0000000000000000000000000000000000000000000000000000000000000003" +
    "0000000000000000000000000000000000000000000000000000000000000004" +
    "0000000000000000000000000000000000000000000000000000000000000005" +
    "0000000000000000000000000000000000000000000000000000000000000006" +
    "0000000000000000000000000000000000000000000000000000000000000007" +
    "0000000000000000000000000000000000000000000000000000000000000008";

  it("encodes the fixed Groth16 tuple as eight consecutive uint256 words", () => {
    expect(encodeGroth16AbcProofData(abcProof)).to.equal(fixedAbiVector);
  });

  it("encodes the static Groth16 tuple exactly like the ethers ABI coder", () => {
    const expected = AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [abcProof.a, abcProof.b, abcProof.c],
    );

    expect(encodeGroth16AbcProofData(abcProof)).to.equal(expected);
  });

  it("normalizes snarkjs G2 coordinates before packing the envelope", () => {
    const rawProof = {
      pi_a: ["1", "2", "1"],
      pi_b: [
        ["4", "3"],
        ["6", "5"],
        ["1", "0"],
      ],
      pi_c: ["7", "8", "1"],
    };

    expect(normalizeGroth16Proof(rawProof)).to.deep.equal(abcProof);
    expect(packGroth16ProofEnvelope(rawProof)).to.deep.equal({
      proofSystemId: 1,
      proofEncodingId: 1,
      proofData: encodeGroth16AbcProofData(abcProof),
    });
  });

  it("rejects values outside the uint256 range", () => {
    expect(() =>
      encodeGroth16AbcProofData({
        ...abcProof,
        a: [-1n, 2n],
      }),
    ).to.throw("Value is outside uint256 range");

    expect(() =>
      encodeGroth16AbcProofData({
        ...abcProof,
        c: [7n, 1n << 256n],
      }),
    ).to.throw("Value is outside uint256 range");
  });

  it("rejects malformed fixed-size proof components", () => {
    expect(() =>
      encodeGroth16AbcProofData({
        ...abcProof,
        a: [1n],
      }),
    ).to.throw("Groth16 proof must contain a/b/c components");
  });

  it("rejects malformed snarkjs coordinate arrays before G2 swapping", () => {
    expect(() =>
      normalizeGroth16Proof({
        pi_a: ["1", "2"],
        pi_b: [["3"], ["5", "6"]],
        pi_c: ["7", "8"],
      }),
    ).to.throw("Invalid Groth16 proof structure returned by snarkjs");
  });
});
