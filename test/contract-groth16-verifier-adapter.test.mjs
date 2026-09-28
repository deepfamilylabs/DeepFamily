import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployUnifiedVerifierAdapter } from "./helpers/unifiedVerifierAdapter.mjs";

const ACTIONS = [
  "shield",
  "createPolicy",
  "allocate",
  "topUp",
  "mergeBudget",
  "claim",
  "privateTransfer",
  "unshield",
];
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
    const keyRegistration = await hre.ethers.deployContract("ShieldedKeyRegistryVerifierMock");
    const keySignals = [100n, 200n, 300n, 400n, 500n, 600n, 700n];
    await keyRegistration.configure(keySignals, true);
    const verifiers = { person, disclosure, keyRegistration };
    for (const [index, action] of ACTIONS.entries()) {
      const verifier = await hre.ethers.deployContract("ShieldedGroth16VerifierMock");
      await verifier.configure(true, BigInt(index + 1));
      verifiers[action] = verifier;
    }
    return {
      adapter: await deployUnifiedVerifierAdapter(hre, verifiers),
      verifiers,
      keySignals,
    };
  }

  it("pins all eleven purposes to their intended generated verifier", async function () {
    const { adapter, verifiers, keySignals } = await setup();
    expect(await adapter.verifyProof(0, 1, PROOF, Array(5).fill(0n))).to.equal(true);
    expect(await adapter.verifyProof(1, 1, PROOF, Array(4).fill(0n))).to.equal(false);
    expect(await adapter.verifyProof(2, 1, PROOF, keySignals)).to.equal(true);
    const alteredKeySignals = [...keySignals];
    alteredKeySignals[3] += 1n;
    expect(await adapter.verifyProof(2, 1, PROOF, alteredKeySignals)).to.equal(false);

    for (const [index, route] of [
      "person",
      "disclosure",
      "keyRegistration",
      ...ACTIONS,
    ].entries()) {
      expect(await adapter.verifierForPurpose(index)).to.equal(await verifiers[route].getAddress());
    }
    expect(await adapter.personVerifier()).to.equal(await verifiers.person.getAddress());
    expect(await adapter.disclosureBindingVerifier()).to.equal(
      await verifiers.disclosure.getAddress(),
    );
    expect(await adapter.keyRegistrationVerifier()).to.equal(
      await verifiers.keyRegistration.getAddress(),
    );
    for (const [index, action] of ACTIONS.entries()) {
      expect(await adapter[`${action}Verifier`]()).to.equal(await verifiers[action].getAddress());
      const signals = Array(32).fill(0n);
      signals[0] = BigInt(index);
      signals[25] = BigInt(index + 1);
      signals[30] = 900n;
      signals[31] = 2n;
      expect(await adapter.verifyProof(index + 3, 1, PROOF, signals)).to.equal(true);
      // Every mock expects a distinct amount, so forwarding to another route fails.
      signals[25] += 1n;
      expect(await adapter.verifyProof(index + 3, 1, PROOF, signals)).to.equal(false);
    }
  });

  it("rejects unsupported purposes, encodings and malformed public inputs", async function () {
    const { adapter } = await setup();
    await expect(adapter.verifierForPurpose(11)).to.be.revertedWithCustomError(
      adapter,
      "UnsupportedPurpose",
    );
    await expect(
      adapter.verifyProof(11, 1, PROOF, Array(32).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "UnsupportedPurpose");
    await expect(
      adapter.verifyProof(3, 255, PROOF, Array(32).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "UnsupportedProofEncoding");
    await expect(
      adapter.verifyProof(3, 1, "0x1234", Array(32).fill(0n)),
    ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    for (const [purpose, wrongLength] of [
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 31],
      [10, 33],
    ]) {
      await expect(
        adapter.verifyProof(purpose, 1, PROOF, Array(wrongLength).fill(0n)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    }
  });

  it("allows isolated disabled routes but rejects their use and codeless verifier addresses", async function () {
    const adapter = await deployUnifiedVerifierAdapter(hre);
    expect(await adapter.verifierForPurpose(2)).to.equal(hre.ethers.ZeroAddress);
    await expect(adapter.verifyProof(2, 1, PROOF, Array(7).fill(0n)))
      .to.be.revertedWithCustomError(adapter, "VerifierNotConfigured")
      .withArgs(2);
    const [, eoa] = await hre.ethers.getSigners();
    await expect(
      hre.ethers.deployContract("Groth16VerifierAdapter", [
        eoa.address,
        hre.ethers.ZeroAddress,
        Array(9).fill(hre.ethers.ZeroAddress),
      ]),
    ).to.be.revertedWithCustomError(adapter, "InvalidVerifier");
    const invalidShieldedRoutes = Array(9).fill(hre.ethers.ZeroAddress);
    invalidShieldedRoutes[8] = eoa.address;
    await expect(
      hre.ethers.deployContract("Groth16VerifierAdapter", [
        hre.ethers.ZeroAddress,
        hre.ethers.ZeroAddress,
        invalidShieldedRoutes,
      ]),
    ).to.be.revertedWithCustomError(adapter, "InvalidVerifier");
  });
});
