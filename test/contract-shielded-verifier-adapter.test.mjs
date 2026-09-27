import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

describe("Shielded Groth16 action adapter", () => {
  it("passes a fixed 32-signal proof envelope to its pinned action verifier", async () => {
    const verifier = await hre.ethers.deployContract("ShieldedGroth16VerifierMock");
    const adapter = await hre.ethers.deployContract("ShieldedGroth16ActionAdapter", [
      await verifier.getAddress(),
      5,
    ]);
    const proof = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [
        [1n, 2n],
        [
          [3n, 4n],
          [5n, 6n],
        ],
        [7n, 8n],
      ],
    );
    const signals = Array(32).fill(0n);
    signals[0] = 5n;
    signals[30] = 900n;
    signals[31] = 2n;
    expect(await adapter.verifyProof(proof, signals)).to.equal(true);
    signals[25] = 1n;
    expect(await adapter.verifyProof(proof, signals)).to.equal(false);
    signals[0] = 4n;
    await expect(adapter.verifyProof(proof, signals)).to.be.revertedWithCustomError(
      adapter,
      "WrongAction",
    );
    signals[0] = 5n;
    await expect(adapter.verifyProof("0x1234", signals)).to.be.revertedWithCustomError(
      adapter,
      "MalformedProof",
    );
  });
});
