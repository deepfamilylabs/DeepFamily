import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

const PROOF = hre.ethers.AbiCoder.defaultAbiCoder().encode(
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

describe("Fixed proof routes", function () {
  it("keeps identity and disclosure separate from pool operations", async function () {
    const person = await hre.ethers.deployContract("StubPersonCommitmentVerifier", [true]);
    const disclosure = await hre.ethers.deployContract("StubDisclosureBindingVerifier", [false]);
    const adapter = await hre.ethers.deployContract("Groth16VerifierAdapter", [
      await person.getAddress(),
      await disclosure.getAddress(),
    ]);
    expect(await adapter.verifierForPurpose(0)).to.equal(await person.getAddress());
    expect(await adapter.verifierForPurpose(1)).to.equal(await disclosure.getAddress());
    expect(await adapter.verifyProof(0, 1, PROOF, Array(5).fill(0n))).to.equal(true);
    expect(await adapter.verifyProof(1, 1, PROOF, Array(4).fill(0n))).to.equal(false);
    for (const purpose of [2, 3, 4, 5, 6])
      await expect(
        adapter.verifyProof(purpose, 1, PROOF, Array(7).fill(0n)),
      ).to.be.revertedWithCustomError(adapter, "UnsupportedPurpose");
    for (const [purpose, length] of [
      [0, 4],
      [1, 5],
    ])
      await expect(
        adapter.verifyProof(purpose, 1, PROOF, Array(length).fill(0n)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    await expect(
      adapter.verifyProof(0, 255, PROOF, Array(5).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "UnsupportedProofEncoding");
    await expect(
      adapter.verifyProof(0, 1, "0x1234", Array(5).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    const disabled = await hre.ethers.deployContract("Groth16VerifierAdapter", [
      hre.ethers.ZeroAddress,
      hre.ethers.ZeroAddress,
    ]);
    await expect(disabled.verifyProof(0, 1, PROOF, Array(5).fill(0n)))
      .to.be.revertedWithCustomError(disabled, "VerifierNotConfigured")
      .withArgs(0);
    const [signer] = await hre.ethers.getSigners();
    await expect(
      hre.ethers.deployContract("Groth16VerifierAdapter", [signer.address, hre.ethers.ZeroAddress]),
    ).to.be.revertedWithCustomError(disabled, "InvalidVerifier");
  });

  it("pins shield and one/four-input withdrawals by exact statement length", async function () {
    const verifiers = [];
    for (let index = 0; index < 3; index++) {
      const verifier = await hre.ethers.deployContract("ShieldedGroth16VerifierMock");
      await verifier.configure(true, BigInt(index + 1));
      verifiers.push(verifier);
    }
    const adapter = await hre.ethers.deployContract(
      "ShieldedBoundaryVerifierAdapter",
      await Promise.all(verifiers.map((v) => v.getAddress())),
    );
    expect(await adapter.verifierForPurpose(2)).to.equal(await verifiers[0].getAddress());
    expect(await adapter.verifierForPurpose(6)).to.equal(await verifiers[1].getAddress());
    expect(await adapter.unshield4Verifier()).to.equal(await verifiers[2].getAddress());
    for (const [purpose, length, last] of [
      [2, 7, 1n],
      [6, 11, 2n],
      [6, 20, 3n],
    ]) {
      const signals = Array(length).fill(0n);
      signals[length - 1] = last;
      expect(await adapter.verifyProof(purpose, 1, PROOF, signals)).to.equal(true);
      signals[length - 1]++;
      expect(await adapter.verifyProof(purpose, 1, PROOF, signals)).to.equal(false);
    }
    for (const purpose of [0, 1, 3, 4, 5])
      await expect(
        adapter.verifyProof(purpose, 1, PROOF, Array(7).fill(0n)),
      ).to.be.revertedWithCustomError(adapter, "UnsupportedPurpose");
    for (const [purpose, length] of [
      [2, 11],
      [2, 20],
      [6, 7],
      [6, 12],
    ])
      await expect(
        adapter.verifyProof(purpose, 1, PROOF, Array(length).fill(0n)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    await expect(
      adapter.verifyProof(2, 255, PROOF, Array(7).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "UnsupportedProofEncoding");
    await expect(
      adapter.verifyProof(2, 1, "0x1234", Array(7).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    for (let index = 0; index < 3; index++) {
      const addresses = await Promise.all(verifiers.map((v) => v.getAddress()));
      addresses[index] = hre.ethers.ZeroAddress;
      await expect(
        hre.ethers.deployContract("ShieldedBoundaryVerifierAdapter", addresses),
      ).to.be.revertedWithCustomError(adapter, "InvalidVerifier");
    }
  });
});
