import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2, poseidon3 } from "poseidon-lite";
import { replayLineageTree } from "@deepfamily/protocol-core";

describe(" eligibility source", function () {
  const abi = hre.ethers.AbiCoder.defaultAbiCoder();
  const proof = (signals) => abi.encode(["uint256[]"], [signals]);
  const commitment = (role, secret) => poseidon2([74201n + BigInt(role), secret]);
  const tag = (role, secret, nonce = 12345n) => poseidon3([73301n + BigInt(role), secret, nonce]);
  const personHash = (identity) => hre.ethers.keccak256(hre.ethers.toBeHex(identity, 32));

  async function setup() {
    const [endorser, manager, stranger] = await hre.ethers.getSigners();
    const t3 = await hre.ethers.deployContract("PoseidonT3");
    const t4 = await hre.ethers.deployContract("PoseidonT4");
    const verifier = await hre.ethers.deployContract("FixedProofVerifierMock");
    const family = await hre.ethers.deployContract("SourceFamilyMock");
    const lineage = await hre.ethers.deployContract("SourceLineageMock", [await family.getAddress()]);
    const source = await (await hre.ethers.getContractFactory("EligibilitySource", {
      libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
    })).deploy(await lineage.getAddress(), await verifier.getAddress(), await verifier.getAddress(), await verifier.getAddress());
    const chain = (await hre.ethers.provider.getNetwork()).chainId;
    const scope = BigInt(await source.getAddress());
    await family.setSource(await source.getAddress());
    await family.setManager(personHash(202n), 1, manager.address, true);
    const fact = async (offset = 0n, who = endorser, alteredProof = undefined) => {
      const args = [201n, 202n, endorser.address, 1n, 10000n + offset,
        commitment(0, 30000n + offset), commitment(1, 40000n + offset)];
      const signals = [args[4], args[5], args[6], chain, scope, args[0], args[1], BigInt(args[2]), args[3], await lineage.root(0)];
      return source.connect(who).publishFact(...args, proof(alteredProof ? alteredProof(signals) : signals));
    };
    const trust = async (offset = 0n, who = manager, alteredProof = undefined) => {
      const args = [202n, endorser.address, 1n, 20000n + offset, commitment(2, 50000n + offset)];
      const signals = [args[3], args[4], chain, scope, args[0], BigInt(args[1]), args[2], await lineage.root(1)];
      return source.connect(who).publishTrust(...args, proof(alteredProof ? alteredProof(signals) : signals));
    };
    return { source, family, lineage, endorser, manager, stranger, fact, trust, chain, scope };
  }

  it("authenticates publication, binds all source-proof inputs, and requires the hooked source", async () => {
    const { source, family, lineage, endorser, manager, stranger, fact, trust } = await setup();
    await expect(fact(0n, stranger)).to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(trust(0n, stranger)).to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    for (let index = 0; index < 10; ++index) {
      await expect(fact(0n, endorser, (signals) => {
        signals[index] += 1n;
        return signals;
      })).to.be.revertedWithCustomError(source, "InvalidProof");
    }
    for (let index = 0; index < 8; ++index) {
      await expect(trust(0n, manager, (signals) => {
        signals[index] += 1n;
        return signals;
      })).to.be.revertedWithCustomError(source, "InvalidProof");
    }
    expect(await source.sourceSize(0)).to.equal(0n);
    expect(await source.sourceSize(1)).to.equal(0n);
    await family.setSource(hre.ethers.ZeroAddress);
    await expect(fact()).to.be.revertedWithCustomError(source, "InactiveSource");
    await expect(trust()).to.be.revertedWithCustomError(source, "InactiveSource");
    await family.setSource(await source.getAddress());
    await fact();
    await trust();
    await expect(fact()).to.be.revertedWithCustomError(source, "DuplicateRole");
    await expect(trust()).to.be.revertedWithCustomError(source, "DuplicateRole");
    await expect(source.revokeRoles(endorser.address, [0], [30000]))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(source.beforeEndorsementChange(201, endorser.address))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(source.beforeTrustedChange(202, 1, endorser.address))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(family.revoke(await source.getAddress(), stranger.address, [0], [30000]))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
  });

  it("uses current lineage roots and matches compact source-tree proofs", async () => {
    const { source, fact, trust, lineage, chain, scope, endorser } = await setup();
    const facts = [], trusts = [];
    for (let index = 0; index < 7; ++index) {
      await fact(BigInt(index));
      await trust(BigInt(index));
      facts.push({ leafIndex: BigInt(index), leaf: 10000n + BigInt(index) });
      trusts.push({ leafIndex: BigInt(index), leaf: 20000n + BigInt(index) });
      for (const [treeId, writes] of [[0, facts], [1, trusts]]) {
        const tree = replayLineageTree(writes);
        expect(treeId === 0 ? await source.sourceRoot() : await source.trustedRoot()).to.equal(tree.root);
        for (let leafIndex = 0; leafIndex <= index; ++leafIndex) {
          const expected = tree.generateProof(leafIndex);
          const actual = await source.getSourceProof(treeId, leafIndex);
          expect(actual.leaf).to.equal(expected.leaf);
          expect(actual.root).to.equal(expected.root);
          expect(actual.index).to.equal(BigInt(expected.index));
          expect(actual.depth).to.equal(BigInt(expected.siblings.length));
          expect([...actual.siblings]).to.deep.equal(expected.siblings);
        }
      }
    }
    await lineage.setRoots(8001, 8002);
    const args = [201n, 202n, endorser.address, 1n, 11000n, commitment(0, 31000n), commitment(1, 41000n)];
    await expect(source.publishFact(...args,
      proof([args[4], args[5], args[6], chain, scope, args[0], args[1], BigInt(args[2]), args[3], 1001n])))
      .to.be.revertedWithCustomError(source, "InvalidProof");
    expect([...await source.getSourceLeafPage(0, 5, 5)]).to.deep.equal([10005n, 10006n]);
  });

  it("blocks a lineage mutation unless every associated role was revoked, and rolls back both states", async () => {
    const { source, family, lineage, endorser, fact } = await setup();
    await fact();
    await expect(family.mutateEndorsement(await lineage.getAddress(), 201, endorser.address))
      .to.be.revertedWithCustomError(source, "MissingRoleRevocation").withArgs(0, commitment(0, 30000n));
    await expect(family.connect(endorser).revokeAndEndorse(
      await source.getAddress(), await lineage.getAddress(), 201, endorser.address, [0], [30000], false,
    )).to.be.revertedWithCustomError(source, "MissingRoleRevocation").withArgs(1, commitment(1, 40000n));
    expect(await source.revokedRoleCount(0)).to.equal(0n);
    await expect(family.connect(endorser).revokeAndEndorse(
      await source.getAddress(), await lineage.getAddress(), 201, endorser.address, [0, 1], [30000, 40000], true,
    )).to.be.revertedWith("mock mutation failure");
    expect(await source.revokedRoleCount(0)).to.equal(0n);
    expect(await source.revokedRoleCount(1)).to.equal(0n);
    expect(await lineage.root(0)).to.equal(1001n);
    await family.connect(endorser).revokeAndEndorse(
      await source.getAddress(), await lineage.getAddress(), 201, endorser.address, [0, 1], [30000, 40000], false,
    );
    expect(await source.isRoleRevoked(0, 12345, tag(0, 30000n))).to.equal(true);
    expect(await source.isRoleRevoked(1, 12345, tag(1, 40000n))).to.equal(true);
    expect(await source.isRoleRevoked(0, 12346, tag(0, 30000n))).to.equal(false);
    expect(await lineage.root(0)).to.equal(1002n);
    await expect(family.revoke(await source.getAddress(), endorser.address, [0], [30000]))
      .to.be.revertedWithCustomError(source, "RoleAlreadyRevoked");
    expect([...await source.getRevokedRolePage(0, 0, 5)]).to.deep.equal([30000n]);
  });

  it("authorizes trusted-role revocation using the current manager", async () => {
    const { source, family, lineage, endorser, manager, stranger, trust } = await setup();
    await trust();
    await expect(family.connect(stranger).revokeAndUntrust(
      await source.getAddress(), await lineage.getAddress(), 202, 1, endorser.address, [2], [50000],
    )).to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await family.setManager(personHash(202n), 1, manager.address, false);
    await family.setManager(personHash(202n), 1, stranger.address, true);
    await expect(family.connect(manager).revokeAndUntrust(
      await source.getAddress(), await lineage.getAddress(), 202, 1, endorser.address, [2], [50000],
    )).to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await family.connect(stranger).revokeAndUntrust(
      await source.getAddress(), await lineage.getAddress(), 202, 1, endorser.address, [2], [50000],
    );
    expect(await source.isRoleRevoked(2, 12345, tag(2, 50000n))).to.equal(true);
    expect(await lineage.root(1)).to.equal(1003n);
  });

  it("bounds active roles per lineage key and prunes permanently revoked roles", async () => {
    const { source, family, endorser, fact } = await setup();
    for (let index = 0; index < 64; ++index) await fact(BigInt(index));
    await expect(fact(64n)).to.be.revertedWithCustomError(source, "TooManyActiveRoles");
    expect(await source.sourceSize(0)).to.equal(64n);
    await family.revoke(await source.getAddress(), endorser.address, [0, 1], [30000, 40000]);
    await fact(64n);
    expect(await source.sourceSize(0)).to.equal(65n);
    await expect(fact(65n)).to.be.revertedWithCustomError(source, "TooManyActiveRoles");
  });
});
