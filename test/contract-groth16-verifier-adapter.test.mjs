import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployUnifiedVerifierAdapter } from "./helpers/unifiedVerifierAdapter.mjs";

const ACTIONS = ["shield", "fund", "claim", "privateTransfer", "unshield"];
// Mirrors ProofConstants.sol and SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS.
const SIGNAL_COUNTS = [7, 16, 27, 12, 12];
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

describe("Unified Groth16 verifier adapter", function () {
  async function setup() {
    const person = await hre.ethers.deployContract("StubPersonCommitmentVerifier", [true]);
    const disclosure = await hre.ethers.deployContract("StubDisclosureBindingVerifier", [false]);
    const verifiers = { person, disclosure };
    for (const [index, action] of ACTIONS.entries()) {
      const verifier = await hre.ethers.deployContract("ShieldedGroth16VerifierMock");
      await verifier.configure(true, BigInt(index + 1));
      verifiers[action] = verifier;
    }
    return { adapter: await deployUnifiedVerifierAdapter(hre, verifiers), verifiers };
  }

  it("pins all seven purposes to their intended generated verifier", async function () {
    const { adapter, verifiers } = await setup();
    expect(await adapter.verifyProof(0, 1, PROOF, Array(5).fill(0n))).to.equal(true);
    expect(await adapter.verifyProof(1, 1, PROOF, Array(4).fill(0n))).to.equal(false);

    for (const [index, route] of ["person", "disclosure", ...ACTIONS].entries()) {
      expect(await adapter.verifierForPurpose(index)).to.equal(await verifiers[route].getAddress());
    }
    expect(await adapter.personVerifier()).to.equal(await verifiers.person.getAddress());
    expect(await adapter.disclosureBindingVerifier()).to.equal(
      await verifiers.disclosure.getAddress(),
    );
    for (const [index, action] of ACTIONS.entries()) {
      expect(await adapter[`${action}Verifier`]()).to.equal(await verifiers[action].getAddress());
      const signals = Array(SIGNAL_COUNTS[index]).fill(0n);
      signals[signals.length - 1] = BigInt(index + 1);
      expect(await adapter.verifyProof(index + 2, 1, PROOF, signals)).to.equal(true);
      // Every mock expects a distinct final signal, so forwarding to another route fails.
      signals[signals.length - 1] += 1n;
      expect(await adapter.verifyProof(index + 2, 1, PROOF, signals)).to.equal(false);
    }
  });

  it("rejects unsupported purposes, encodings and malformed public inputs", async function () {
    const { adapter } = await setup();
    await expect(adapter.verifierForPurpose(7)).to.be.revertedWithCustomError(
      adapter,
      "UnsupportedPurpose",
    );
    await expect(
      adapter.verifyProof(7, 1, PROOF, Array(12).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "UnsupportedPurpose");
    await expect(
      adapter.verifyProof(2, 255, PROOF, Array(7).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "UnsupportedProofEncoding");
    await expect(
      adapter.verifyProof(2, 1, "0x1234", Array(7).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    for (const [purpose, wrongLength] of [
      [0, 4],
      [1, 5],
      [2, 8],
      [3, 12],
      [4, 12],
      [5, 32],
      [6, 11],
    ]) {
      await expect(
        adapter.verifyProof(purpose, 1, PROOF, Array(wrongLength).fill(0n)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    }
  });

  it("allows isolated disabled routes but rejects their use and codeless verifier addresses", async function () {
    const adapter = await deployUnifiedVerifierAdapter(hre);
    expect(await adapter.verifierForPurpose(4)).to.equal(hre.ethers.ZeroAddress);
    await expect(adapter.verifyProof(4, 1, PROOF, Array(27).fill(0n)))
      .to.be.revertedWithCustomError(adapter, "VerifierNotConfigured")
      .withArgs(4);
    const [, eoa] = await hre.ethers.getSigners();
    await expect(
      hre.ethers.deployContract("Groth16VerifierAdapter", [
        eoa.address,
        hre.ethers.ZeroAddress,
        Array(5).fill(hre.ethers.ZeroAddress),
      ]),
    ).to.be.revertedWithCustomError(adapter, "InvalidVerifier");
    const invalidShieldedRoutes = Array(5).fill(hre.ethers.ZeroAddress);
    invalidShieldedRoutes[4] = eoa.address;
    await expect(
      hre.ethers.deployContract("Groth16VerifierAdapter", [
        hre.ethers.ZeroAddress,
        hre.ethers.ZeroAddress,
        invalidShieldedRoutes,
      ]),
    ).to.be.revertedWithCustomError(adapter, "InvalidVerifier");
  });
});
