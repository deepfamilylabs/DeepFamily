import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { computeShieldedRegistrationLeaf, createLineageTree } from "@deepfamily/protocol-core";

const EMPTY_PROOF = [
  [0n, 0n],
  [
    [0n, 0n],
    [0n, 0n],
  ],
  [0n, 0n],
];

describe("Shielded heir key registry transport", function () {
  async function setup() {
    const lineage = await hre.ethers.deployContract("ShieldedKeyRegistryLineageMock");
    const verifier = await hre.ethers.deployContract("ShieldedKeyRegistryVerifierMock");
    const poseidonT3 = await hre.ethers.deployContract("PoseidonT3");
    const poseidonT6 = await hre.ethers.deployContract("PoseidonT6");
    const Registry = await hre.ethers.getContractFactory("ShieldedHeirKeyRegistry", {
      libraries: {
        PoseidonT3: await poseidonT3.getAddress(),
        PoseidonT6: await poseidonT6.getAddress(),
      },
    });
    const registry = await Registry.deploy(await lineage.getAddress(), await verifier.getAddress());
    const network = await hre.ethers.provider.getNetwork();
    const identityCommitment = 123456n;
    const personHash = hre.ethers.keccak256(
      hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
    );
    // Distinct limbs detect a swapped Lo/Hi verifier signal or tree-leaf encoding.
    const viewingKey = `0x${"42".repeat(16)}${"43".repeat(16)}`;
    const ownerCommitment = 789n;
    const registrationTag = 987n;
    const signals = [
      identityCommitment,
      ownerCommitment,
      BigInt(`0x${"43".repeat(16)}`),
      BigInt(`0x${"42".repeat(16)}`),
      network.chainId,
      BigInt(await registry.getAddress()),
      registrationTag,
    ];
    await lineage.setIdentity(personHash, identityCommitment);
    await verifier.configure(signals, true);
    return {
      lineage,
      verifier,
      registry,
      identityCommitment,
      personHash,
      viewingKey,
      ownerCommitment,
      registrationTag,
    };
  }

  it("binds identity, owner commitment, key halves, chain and registry in verifier inputs", async () => {
    const context = await setup();
    const {
      registry,
      personHash,
      viewingKey,
      identityCommitment,
      ownerCommitment,
      registrationTag,
    } = context;
    await expect(
      registry.register(
        identityCommitment,
        ownerCommitment,
        viewingKey,
        registrationTag,
        ...EMPTY_PROOF,
      ),
    )
      .to.emit(registry, "ViewingKeyRegistered")
      .withArgs(personHash, identityCommitment, viewingKey, ownerCommitment);
    const registration = await registry.registrationOf(personHash);
    expect(registration.viewingKey).to.equal(viewingKey);
    expect(registration.ownerCommitment).to.equal(ownerCommitment);
    const leaf = computeShieldedRegistrationLeaf({
      identityCommitment,
      ownerCommitment,
      viewKeyHi: BigInt(`0x${"42".repeat(16)}`),
      viewKeyLo: BigInt(`0x${"43".repeat(16)}`),
    });
    const tree = createLineageTree([leaf]);
    expect((await registry.keyShard(0)).root).to.equal(tree.root);
    expect(await registry.isKnownRoot(0, tree.root)).to.equal(true);
    expect(await registry.knownRootSize(0, tree.root)).to.equal(1n);
    const proof = await registry.getMerkleProof(0, 0);
    expect(proof.leaf).to.equal(leaf);
    expect(proof.proofRoot).to.equal(tree.root);
    expect(proof.proofDepth).to.equal(0n);
    const secondIdentity = identityCommitment + 1n;
    const secondPersonHash = hre.ethers.keccak256(
      hre.ethers.zeroPadValue(hre.ethers.toBeHex(secondIdentity), 32),
    );
    await context.lineage.setIdentity(secondPersonHash, secondIdentity);
    await context.verifier.configure(
      [
        secondIdentity,
        ownerCommitment,
        BigInt(`0x${"43".repeat(16)}`),
        BigInt(`0x${"42".repeat(16)}`),
        (await hre.ethers.provider.getNetwork()).chainId,
        BigInt(await registry.getAddress()),
        registrationTag,
      ],
      true,
    );
    await registry.register(
      secondIdentity,
      ownerCommitment,
      viewingKey,
      registrationTag,
      ...EMPTY_PROOF,
    );
    expect(await registry.knownRootSize(0, tree.root)).to.equal(1n);
    expect(await registry.knownRootSize(0, (await registry.keyShard(0)).root)).to.equal(2n);
    await expect(
      registry.register(
        identityCommitment,
        ownerCommitment,
        viewingKey,
        registrationTag,
        ...EMPTY_PROOF,
      ),
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
  });

  it("rejects unknown identity and substituted key", async () => {
    const context = await setup();
    const { registry, identityCommitment, ownerCommitment, viewingKey, registrationTag } = context;
    await expect(
      registry.register(
        identityCommitment + 1n,
        ownerCommitment,
        viewingKey,
        registrationTag,
        ...EMPTY_PROOF,
      ),
    ).to.be.revertedWithCustomError(registry, "UnknownIdentity");
    await expect(
      registry.register(
        identityCommitment,
        ownerCommitment,
        `0x${"43".repeat(32)}`,
        registrationTag,
        ...EMPTY_PROOF,
      ),
    ).to.be.revertedWithCustomError(registry, "InvalidRegistrationProof");
    await expect(
      registry.register(
        identityCommitment,
        ownerCommitment,
        `0x${"42".repeat(32)}`,
        registrationTag,
        ...EMPTY_PROOF,
      ),
    ).to.be.revertedWithCustomError(registry, "InvalidRegistrationProof");
  });
});
