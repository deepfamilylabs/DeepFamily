import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import {
  computeIdentityFromDerivedSecret,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  replayLineageTree,
} from "@deepfamily/protocol-core";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  addPerson,
  deployLineageIndex,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

const ENDORSEMENT_TREE = 0;
const TRUSTED_TREE = 1;

const identityOf = (person) =>
  computeIdentityFromDerivedSecret({
    identity: person,
    identitySuiteId: 1,
    derivedSecretField: person.derivedSecretField,
  });

async function replayedTree(lineageIndex, treeId) {
  const events = await lineageIndex.queryFilter(lineageIndex.filters.LeafWritten(treeId));
  events.sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index);
  return replayLineageTree(
    events.map(({ args }) => ({ leafIndex: args.leafIndex, leaf: args.leaf })),
  );
}

async function expectTreesMirrored(lineageIndex) {
  for (const treeId of [ENDORSEMENT_TREE, TRUSTED_TREE]) {
    const tree = await replayedTree(lineageIndex, treeId);
    const expectedRoot = tree.size === 0 ? 0n : tree.root;
    expect(await lineageIndex.root(treeId), `tree ${treeId} root`).to.equal(expectedRoot);
    expect(await lineageIndex.size(treeId), `tree ${treeId} size`).to.equal(BigInt(tree.size));
    expect(await lineageIndex.depth(treeId), `tree ${treeId} depth`).to.equal(BigInt(tree.depth));
  }
}

const blockTime = async (receipt) => BigInt((await receipt.getBlock()).timestamp);

describe("DeepFamily lineage index", function () {
  this.timeout(120_000);

  async function setup() {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    await setupStubVerifiers(hre.ethers, deployed.deepFamily);
    const signers = await hre.ethers.getSigners();
    return { ...deployed, signers };
  }

  async function addFamily({ deepFamily, token, signers }) {
    const [manager, second, third] = signers;
    const root = makeTestPerson("Lineage Root", { derivedSecretField: 1001n, birthYear: 1930 });
    const spouse = makeTestPerson("Lineage Spouse", {
      derivedSecretField: 1002n,
      birthYear: 1932,
      gender: 2,
    });
    const child = makeTestPerson("Lineage Child", { derivedSecretField: 1003n, birthYear: 1960 });
    const rootHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: root,
      tag: "root",
    });
    // A complete-parent version mints DEEP to its submitter, which then funds endorsement fees.
    const childHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child,
      fatherPerson: root,
      motherPerson: spouse,
      tag: "child",
    });
    // Four more complete-parent children accumulate enough DEEP to fund every endorsement fee.
    for (let index = 0; index < 4; index += 1) {
      await addPerson(hre.ethers, deepFamily, manager, undefined, {
        person: makeTestPerson(`Lineage Sibling ${index}`, {
          derivedSecretField: 2000n + BigInt(index),
        }),
        fatherPerson: root,
        motherPerson: spouse,
        tag: `sibling-${index}`,
      });
    }
    const fee = await token.recentReward();
    for (const endorser of [manager, second, third]) {
      if (endorser !== manager) await token.connect(manager).transfer(endorser.address, fee * 3n);
      await token.connect(endorser).approve(await deepFamily.getAddress(), hre.ethers.MaxUint256);
    }
    return { root, spouse, child, rootHash, childHash };
  }

  it("mirrors every version, endorsement and trusted-endorser change into both trees", async () => {
    const context = await setup();
    const { deepFamily, lineageIndex, signers } = context;
    const [manager, second, third] = signers;
    await expectTreesMirrored(lineageIndex);

    const family = await addFamily(context);
    await expectTreesMirrored(lineageIndex);
    const rootIdentity = identityOf(family.root);
    const spouseIdentity = identityOf(family.spouse);
    const childIdentity = identityOf(family.child);
    const parentsDigest = computeLineageParentsDigest({
      fatherIdentityCommitment: rootIdentity.identityCommitment,
      motherIdentityCommitment: spouseIdentity.identityCommitment,
    });
    expect(await lineageIndex.identityCommitmentOf(family.childHash)).to.equal(
      childIdentity.identityCommitment,
    );
    expect(await lineageIndex.parentsDigestOf(family.childHash, 1)).to.equal(parentsDigest);
    const [indexed] = await lineageIndex.queryFilter(
      lineageIndex.filters.VersionIndexed(family.childHash, 1),
    );
    expect(indexed.args.identityCommitment).to.equal(childIdentity.identityCommitment);
    expect(indexed.args.fatherIdentityCommitment).to.equal(rootIdentity.identityCommitment);
    expect(indexed.args.motherIdentityCommitment).to.equal(spouseIdentity.identityCommitment);

    // Each new version makes its submitter a trusted endorser of that version.
    const [rootTrustedExists, rootTrustedIndex] = await lineageIndex.trustedLeafIndex(
      family.rootHash,
      1,
      manager.address,
    );
    expect(rootTrustedExists).to.equal(true);
    const trustedTree = await replayedTree(lineageIndex, TRUSTED_TREE);
    expect(trustedTree.leaves[Number(rootTrustedIndex)]).to.equal(
      computeLineageTrustedLeaf({
        rootIdentityCommitment: rootIdentity.identityCommitment,
        rootVersionIndex: 1,
        account: manager.address,
      }),
    );

    const endorsed = await (
      await deepFamily.connect(second).endorseVersion(family.childHash, 1)
    ).wait();
    await expectTreesMirrored(lineageIndex);
    const [endorsementExists, endorsementIndex] = await lineageIndex.endorsementLeafIndex(
      family.childHash,
      second.address,
    );
    expect(endorsementExists).to.equal(true);
    expect(
      (await replayedTree(lineageIndex, ENDORSEMENT_TREE)).leaves[Number(endorsementIndex)],
    ).to.equal(
      computeLineageEndorsementLeaf({
        identityCommitment: childIdentity.identityCommitment,
        parentsDigest,
        versionIndex: 1,
        endorser: second.address,
        writtenAt: await blockTime(endorsed),
      }),
    );

    // A second version of the child: switching the endorsement rewrites the same leaf slot.
    await addPerson(hre.ethers, deepFamily, third, undefined, {
      person: family.child,
      fatherPerson: family.root,
      tag: "child-v2",
    });
    await expectTreesMirrored(lineageIndex);
    await (await deepFamily.connect(second).endorseVersion(family.childHash, 2)).wait();
    await expectTreesMirrored(lineageIndex);
    const [, switchedIndex] = await lineageIndex.endorsementLeafIndex(
      family.childHash,
      second.address,
    );
    expect(switchedIndex).to.equal(endorsementIndex);

    await (await deepFamily.connect(third).endorseVersion(family.rootHash, 1)).wait();
    await (await deepFamily.connect(second).cancelEndorsement(family.childHash)).wait();
    await expectTreesMirrored(lineageIndex);
    expect(
      (await replayedTree(lineageIndex, ENDORSEMENT_TREE)).leaves[Number(endorsementIndex)],
    ).to.equal(0n);
    // Endorsing again after a cancellation reuses the cleared slot.
    await (await deepFamily.connect(second).endorseVersion(family.childHash, 1)).wait();
    const [, reusedIndex] = await lineageIndex.endorsementLeafIndex(
      family.childHash,
      second.address,
    );
    expect(reusedIndex).to.equal(endorsementIndex);

    await (
      await deepFamily.connect(manager).addTrustedEndorser(family.rootHash, 1, second.address)
    ).wait();
    await expectTreesMirrored(lineageIndex);
    const [, secondTrustedIndex] = await lineageIndex.trustedLeafIndex(
      family.rootHash,
      1,
      second.address,
    );
    await (
      await deepFamily.connect(manager).removeTrustedEndorser(family.rootHash, 1, second.address)
    ).wait();
    await expectTreesMirrored(lineageIndex);
    expect(
      (await replayedTree(lineageIndex, TRUSTED_TREE)).leaves[Number(secondTrustedIndex)],
    ).to.equal(0n);
    await (
      await deepFamily.connect(manager).addTrustedEndorser(family.rootHash, 1, second.address)
    ).wait();
    const [, readdedIndex] = await lineageIndex.trustedLeafIndex(
      family.rootHash,
      1,
      second.address,
    );
    expect(readdedIndex).to.equal(secondTrustedIndex);
    await expectTreesMirrored(lineageIndex);
  });

  it("keeps a replaced root verifiable for one hour only", async () => {
    const context = await setup();
    const { deepFamily, lineageIndex, signers } = context;
    const family = await addFamily(context);
    await (await deepFamily.connect(signers[1]).endorseVersion(family.childHash, 1)).wait();
    const replaced = await lineageIndex.root(ENDORSEMENT_TREE);
    await (await deepFamily.connect(signers[2]).endorseVersion(family.childHash, 1)).wait();
    const current = await lineageIndex.root(ENDORSEMENT_TREE);
    expect(current).to.not.equal(replaced);

    expect(await lineageIndex.isKnownRoot(ENDORSEMENT_TREE, current)).to.equal(true);
    expect(await lineageIndex.isKnownRoot(ENDORSEMENT_TREE, replaced)).to.equal(true);
    expect(await lineageIndex.isKnownRoot(ENDORSEMENT_TREE, 0)).to.equal(false);
    expect(await lineageIndex.isKnownRoot(TRUSTED_TREE, current)).to.equal(false);
    await hre.networkHelpers.time.increase(3601);
    expect(await lineageIndex.isKnownRoot(ENDORSEMENT_TREE, replaced)).to.equal(false);
    expect(await lineageIndex.isKnownRoot(ENDORSEMENT_TREE, current)).to.equal(true);
    await expect(lineageIndex.isKnownRoot(2, current)).to.be.revertedWithCustomError(
      lineageIndex,
      "InvalidTreeId",
    );
  });

  it("accepts writes from DeepFamily only", async () => {
    const { lineageIndex, signers } = await setup();
    const personHash = hre.ethers.ZeroHash;
    await expect(
      lineageIndex.connect(signers[0]).onVersionAdded(personHash, 1, 1, 0, 0),
    ).to.be.revertedWithCustomError(lineageIndex, "UnauthorizedCaller");
    await expect(
      lineageIndex.onTrustedEndorserSet(personHash, 1, signers[0].address, true),
    ).to.be.revertedWithCustomError(lineageIndex, "UnauthorizedCaller");
    await expect(
      lineageIndex.onEndorsementSet(personHash, signers[0].address, 1),
    ).to.be.revertedWithCustomError(lineageIndex, "UnauthorizedCaller");
    await expect(
      lineageIndex.onEndorsementCleared(personHash, signers[0].address),
    ).to.be.revertedWithCustomError(lineageIndex, "UnauthorizedCaller");
  });

  it("binds exactly one lineage index through the proxy owner", async () => {
    const { deepFamily, lineageIndex, signers } = await setup();
    const [owner, outsider] = signers;
    expect(await deepFamily.lineageIndex()).to.equal(await lineageIndex.getAddress());
    expect(await lineageIndex.DEEP_FAMILY()).to.equal(await deepFamily.getAddress());
    expect(await lineageIndex.indexKind()).to.equal(hre.ethers.id("deepfamily.lineage-index.v1"));
    expect(await lineageIndex.apiVersion()).to.equal(1n);

    await expect(
      deepFamily.connect(owner).setLineageIndex(await lineageIndex.getAddress()),
    ).to.be.revertedWithCustomError(deepFamily, "LineageIndexAlreadySet");
    await expect(
      deepFamily.connect(outsider).setLineageIndex(await lineageIndex.getAddress()),
    ).to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");
  });

  it("rejects unbound, misbound and non-index candidates, and blocks versions until bound", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Token = await hre.ethers.getContractFactory("DeepFamilyToken");
    const token = await Token.deploy();
    const poseidon = await (await hre.ethers.getContractFactory("PoseidonT5")).deploy();
    const adultAgeGate = await (await hre.ethers.getContractFactory("AdultAgeGate")).deploy();
    const DeepFamily = await hre.ethers.getContractFactory("DeepFamily", {
      libraries: {
        PoseidonT5: await poseidon.getAddress(),
        AdultAgeGate: await adultAgeGate.getAddress(),
      },
    });
    const deployProxy = async () => {
      const implementation = await DeepFamily.deploy();
      const initData = DeepFamily.interface.encodeFunctionData("initialize", [
        await token.getAddress(),
        owner.address,
      ]);
      const proxy = await (
        await hre.ethers.getContractFactory("UUPSProxy")
      ).deploy(await implementation.getAddress(), initData);
      return { implementation, deepFamily: DeepFamily.attach(await proxy.getAddress()) };
    };
    const { implementation, deepFamily } = await deployProxy();
    const { deepFamily: otherDeepFamily } = await deployProxy();
    const archive = await (
      await hre.ethers.getContractFactory("DeepFamilyArchive")
    ).deploy(await deepFamily.getAddress());
    await deepFamily.setArchive(await archive.getAddress());
    await setupStubVerifiers(hre.ethers, deepFamily);

    await expect(
      addPerson(hre.ethers, deepFamily, owner, undefined, { fullName: "Unbound Index" }),
    ).to.be.revertedWithCustomError(deepFamily, "LineageIndexNotSet");

    const misbound = await deployLineageIndex(
      hre.ethers,
      await otherDeepFamily.getAddress(),
      await poseidon.getAddress(),
    );
    for (const candidate of [hre.ethers.ZeroAddress, owner.address, await archive.getAddress()]) {
      await expect(deepFamily.setLineageIndex(candidate)).to.be.revertedWithCustomError(
        deepFamily,
        "InvalidLineageIndex",
      );
    }
    await expect(
      deepFamily.setLineageIndex(await misbound.getAddress()),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidLineageIndex");

    const bound = await deployLineageIndex(
      hre.ethers,
      await deepFamily.getAddress(),
      await poseidon.getAddress(),
    );
    await expect(implementation.setLineageIndex(await bound.getAddress())).to.revert(hre.ethers);
    await expect(deepFamily.setLineageIndex(await bound.getAddress()))
      .to.emit(deepFamily, "LineageIndexSet")
      .withArgs(await bound.getAddress());
    await addPerson(hre.ethers, deepFamily, owner, undefined, { fullName: "Bound Index" });
    expect(await bound.size(TRUSTED_TREE)).to.equal(1n);
  });
});
