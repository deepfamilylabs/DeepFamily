import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2 } from "poseidon-lite";

// Source authentication is explicitly echoed here. The fixed Capability/Claim
// circuits and actual money path bind these indices in the real-proof suites.
describe("direct qualification role status", function () {
  const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const roleIndex = (role, secret) => poseidon2([74321n + BigInt(role), secret]);
  const commitment = (role, secret) => poseidon2([74201n + BigInt(role), secret]);

  async function setup() {
    const [controller, manager, stranger] = await hre.ethers.getSigners();
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    const verifier = await hre.ethers.deployContract("FixedProofVerifierMock");
    const family = await hre.ethers.deployContract("SourceFamilyMock");
    const lineage = await hre.ethers.deployContract("SourceLineageMock", [await family.getAddress()]);
    const factory = await hre.ethers.getContractFactory("EligibilitySource", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const verifierAddress = await verifier.getAddress();
    const source = await factory.deploy(await lineage.getAddress(), verifierAddress, verifierAddress);
    const sourceAddress = await source.getAddress();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const scope = BigInt(sourceAddress);
    const echo = signals => hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [signals]);
    await family.setSource(sourceAddress);
    await family.setManager(hre.ethers.keccak256(hre.ethers.toBeHex(202n, 32)), 1, manager.address, true);
    let serial = 0n;
    const publish = async secrets => {
      const offset = serial++;
      const factLeaf = 10000n + offset, trustLeaf = 20000n + offset;
      const factCommitments = secrets.slice(0, 2).map((secret, role) => commitment(role, secret));
      await source.connect(controller).publishFact(201n, 202n, controller.address, 1n, factLeaf, ...factCommitments,
        echo([factLeaf, ...factCommitments, chainId, scope, 201n, 202n, BigInt(controller.address), 1n, await lineage.root(0)]));
      const trustCommitment = commitment(2, secrets[2]);
      await source.connect(manager).publishTrust(202n, controller.address, 1n, trustLeaf, trustCommitment,
        echo([trustLeaf, trustCommitment, chainId, scope, 202n, BigInt(controller.address), 1n, await lineage.root(1)]));
    };
    const revoke = async (roles, secrets, actor = controller.address) => family.revoke(sourceAddress, actor, roles, secrets);
    const target = [30000n, 40000n, 50000n];
    await publish(target);
    return { source, sourceAddress, factory, lineage, verifierAddress, family, controller, manager, stranger, publish, revoke, target };
  }
  const fixture = () => hre.networkHelpers.loadFixture(setup);

  it("uses stable role indices in a domain separate from publicly registered source commitments", async () => {
    const { source, target } = await fixture();
    for (let role = 0; role < 3; ++role) {
      const index = roleIndex(role, target[role]);
      expect(index).not.to.equal(commitment(role, target[role]));
      expect(await source.isRoleRevoked(role, index)).to.equal(false);
      expect((await source.roleRecord(role, commitment(role, target[role]))).registered).to.equal(true);
      // A currently false flag is only a status lookup. Unknown indices do not
      // establish issuance, identity or qualification without the accepting proof.
      expect(await source.isRoleRevoked(role, roleIndex(role, 999999n))).to.equal(false);
    }
    for (const name of ["prepareRoleScan", "roleScanProgress", "revocationCheckpoint", "SCAN_VERIFIER"])
      expect(source.interface.getFunction(name)).to.equal(null);
  });

  it("immediately revokes one role and keeps different roles, indices and Sources isolated", async () => {
    const { source, target, revoke, manager, factory, lineage, verifierAddress } = await fixture();
    const another = await factory.deploy(await lineage.getAddress(), verifierAddress, verifierAddress);
    for (let role = 0; role < 3; ++role) {
      await revoke([role], [target[role]], role === 2 ? manager.address : undefined);
      expect(await source.isRoleRevoked(role, roleIndex(role, target[role]))).to.equal(true);
      expect(await source.isRoleRevoked((role + 1) % 3, roleIndex(role, target[role]))).to.equal(false);
      expect(await source.isRoleRevoked(role, roleIndex(role, target[role] + 1n))).to.equal(false);
      expect(await another.isRoleRevoked(role, roleIndex(role, target[role]))).to.equal(false);
      await expect(revoke([role], [target[role]], role === 2 ? manager.address : undefined))
        .to.be.revertedWithCustomError(source, "RoleAlreadyRevoked");
    }
  });

  it("preserves authorization and atomically rolls back revocation status with a failed relation change", async () => {
    const { source, sourceAddress, target, family, lineage, controller, stranger, revoke } = await fixture();
    await expect(revoke([0], [target[0]], stranger.address))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(source.revokeRoles(controller.address, [0], [target[0]]))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(family.connect(controller).revokeAndEndorse(sourceAddress, await lineage.getAddress(),
      201n, controller.address, [0, 1], target.slice(0, 2), true)).to.be.revertedWith("mock mutation failure");
    for (let role = 0; role < 3; ++role) {
      expect(await source.isRoleRevoked(role, roleIndex(role, target[role]))).to.equal(false);
      expect(await source.revokedRoleCount(role)).to.equal(0n);
    }
    expect(await lineage.root(0)).to.equal(1001n);
    await expect(family.connect(controller).revokeAndEndorse(sourceAddress, await lineage.getAddress(),
      201n, controller.address, [0], target.slice(0, 1), false))
      .to.be.revertedWithCustomError(source, "MissingRoleRevocation").withArgs(1, commitment(1, target[1]));
    expect(await source.isRoleRevoked(0, roleIndex(0, target[0]))).to.equal(false);
  });

  it("reads one storage slot regardless of unrelated revocation history", async () => {
    const { source, sourceAddress, controller, publish, revoke, manager, target } = await fixture();
    const measure = async role => {
      const call = source.interface.encodeFunctionData("isRoleRevoked", [role, roleIndex(role, target[role])]);
      const receipt = await (await controller.sendTransaction({ to: sourceAddress, data: call })).wait();
      const trace = await hre.ethers.provider.send("debug_traceTransaction", [receipt.hash, {}]);
      expect(trace.structLogs.filter(step => step.op === "SLOAD")).to.have.length(1);
      expect(await source.isRoleRevoked(role, roleIndex(role, target[role]))).to.equal(false);
      return receipt.gasUsed;
    };
    const before = [];
    for (let role = 0; role < 3; ++role) before.push(await measure(role));
    for (let serial = 0n; serial < 64n; ++serial) {
      const secrets = [100000n + serial, 200000n + serial, 300000n + serial];
      await publish(secrets);
      await revoke([0, 1], secrets.slice(0, 2));
      await revoke([2], [secrets[2]], manager.address);
    }
    for (let role = 0; role < 3; ++role) {
      expect(await source.revokedRoleCount(role)).to.equal(64n);
      expect(await measure(role)).to.equal(before[role]);
    }
    await revoke([0], [target[0]]);
    expect(await source.isRoleRevoked(0, roleIndex(0, target[0]))).to.equal(true);
  });

  it("rejects invalid roles and noncanonical indices before reading status", async () => {
    const { source, target } = await fixture();
    await expect(source.isRoleRevoked(3, roleIndex(0, target[0])))
      .to.be.revertedWithCustomError(source, "InvalidRole");
    for (const index of [0n, FIELD, FIELD + 1n])
      await expect(source.isRoleRevoked(0, index)).to.be.revertedWithCustomError(source, "InvalidField");
  });
});
