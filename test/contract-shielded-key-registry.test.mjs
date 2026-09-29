import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployUnifiedVerifierAdapter } from "./helpers/unifiedVerifierAdapter.mjs";
import { createLineageTree } from "@deepfamily/protocol-core";

const EMPTY_PROOF = hre.ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint256[2]", "uint256[2][2]", "uint256[2]"],
  [
    [0n, 0n],
    [
      [0n, 0n],
      [0n, 0n],
    ],
    [0n, 0n],
  ],
);

describe("Shielded heir key registry transport", function () {
  async function setup() {
    const verifier = await hre.ethers.deployContract("ShieldedKeyRegistryVerifierMock");
    const adapter = await deployUnifiedVerifierAdapter(hre, { keyRegistration: verifier });
    const poseidonT3 = await hre.ethers.deployContract("PoseidonT3");
    const Registry = await hre.ethers.getContractFactory("ShieldedHeirKeyRegistry", {
      libraries: { PoseidonT3: await poseidonT3.getAddress() },
    });
    const registry = await Registry.deploy(await adapter.getAddress());
    const network = await hre.ethers.provider.getNetwork();
    // Distinct limbs detect a swapped Lo/Hi verifier signal.
    const viewingKey = `0x${"42".repeat(16)}${"43".repeat(16)}`;
    const ownerCommitment = 789n;
    const registrationTag = 987n;
    const registrationLeaf = 123456789n;
    const signals = [
      ownerCommitment,
      BigInt(`0x${"43".repeat(16)}`),
      BigInt(`0x${"42".repeat(16)}`),
      network.chainId,
      BigInt(await registry.getAddress()),
      registrationTag,
      registrationLeaf,
    ];
    await verifier.configure(signals, true);
    return { verifier, registry, viewingKey, ownerCommitment, registrationTag, registrationLeaf, signals };
  }

  it("binds the anonymous tag, owner, key, leaf, chain and registry to the proof", async () => {
    const { registry, viewingKey, ownerCommitment, registrationTag, registrationLeaf } = await setup();
    expect(registry.interface.getFunction("register").inputs.map((input) => input.name)).to.deep.equal([
      "ownerCommitment", "viewingKey", "registrationTag", "registrationLeaf", "proofData",
    ]);
    expect(registry.interface.getEvent("ViewingKeyRegistered").inputs.map((input) => input.name))
      .to.deep.equal(["registrationTag", "ownerCommitment", "viewingKey", "leaf"]);
    expect(registry.interface.fragments.some((fragment) => fragment.name === "registrationOf"))
      .to.equal(false);

    await expect(registry.register(ownerCommitment, viewingKey, registrationTag, registrationLeaf, EMPTY_PROOF))
      .to.emit(registry, "ViewingKeyRegistered")
      .withArgs(registrationTag, ownerCommitment, viewingKey, registrationLeaf);
    const tree = createLineageTree([registrationLeaf]);
    expect((await registry.keyShard(0)).root).to.equal(tree.root);
    expect(await registry.isKnownRoot(0, tree.root)).to.equal(true);
    expect(await registry.knownRootSize(0, tree.root)).to.equal(1n);
    const proof = await registry.getMerkleProof(0, 0);
    expect(proof.leaf).to.equal(registrationLeaf);
    expect(proof.proofRoot).to.equal(tree.root);
    expect(proof.proofDepth).to.equal(0n);
  });

  it("deduplicates by the identity-secret tag while allowing a distinct anonymous tag", async () => {
    const { registry, verifier, viewingKey, ownerCommitment, registrationTag, registrationLeaf, signals } =
      await setup();
    await registry.register(ownerCommitment, viewingKey, registrationTag, registrationLeaf, EMPTY_PROOF);
    const firstRoot = (await registry.keyShard(0)).root;
    await expect(
      registry.register(ownerCommitment, viewingKey, registrationTag, registrationLeaf, EMPTY_PROOF),
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");

    const secondTag = registrationTag + 1n;
    const secondLeaf = registrationLeaf + 1n;
    await verifier.configure([...signals.slice(0, 5), secondTag, secondLeaf], true);
    await registry.register(ownerCommitment, viewingKey, secondTag, secondLeaf, EMPTY_PROOF);
    expect(await registry.knownRootSize(0, firstRoot)).to.equal(1n);
    expect(await registry.knownRootSize(0, (await registry.keyShard(0)).root)).to.equal(2n);
    expect((await registry.getMerkleProof(0, 1)).leaf).to.equal(secondLeaf);
  });

  it("rejects substituted public inputs and invalid anonymous leaves", async () => {
    const { registry, viewingKey, ownerCommitment, registrationTag, registrationLeaf } = await setup();
    for (const args of [
      [ownerCommitment + 1n, viewingKey, registrationTag, registrationLeaf],
      [ownerCommitment, `0x${"43".repeat(32)}`, registrationTag, registrationLeaf],
      [ownerCommitment, viewingKey, registrationTag + 1n, registrationLeaf],
      [ownerCommitment, viewingKey, registrationTag, registrationLeaf + 1n],
    ]) {
      await expect(registry.register(...args, EMPTY_PROOF))
        .to.be.revertedWithCustomError(registry, "InvalidRegistrationProof");
    }
    await expect(registry.register(ownerCommitment, viewingKey, registrationTag, 0n, EMPTY_PROOF))
      .to.be.revertedWithCustomError(registry, "InvalidLeaf");
  });
});
