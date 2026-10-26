import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2, poseidon3 } from "poseidon-lite";

// The echo verifier isolates the Source's public-input binding and progress rules.
// Cryptographic interval completeness/non-revocation is checked by the real circuit tests.
describe("authenticated bounded role revocation scans", function () {
  this.timeout(120_000);
  const abi = hre.ethers.AbiCoder.defaultAbiCoder();
  const echo = signals => abi.encode(["uint256[]"], [signals]);
  const nonce = 12345n;
  const roleCommitment = (role, secret) => poseidon2([74201n + BigInt(role), secret]);
  const roleTag = (role, secret, codeNonce = nonce) => poseidon3([73301n + BigInt(role), secret, codeNonce]);

  async function setup() {
    const [controller, stranger] = await hre.ethers.getSigners();
    const t3 = await hre.ethers.deployContract("PoseidonT3");
    const t4 = await hre.ethers.deployContract("PoseidonT4");
    const verifier = await hre.ethers.deployContract("FixedProofVerifierMock");
    const family = await hre.ethers.deployContract("SourceFamilyMock");
    const lineage = await hre.ethers.deployContract("SourceLineageMock", [await family.getAddress()]);
    const factory = await hre.ethers.getContractFactory("EligibilitySource", {
      libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
    });
    const verifierAddress = await verifier.getAddress();
    const source = await factory.deploy(await lineage.getAddress(), verifierAddress, verifierAddress, verifierAddress);
    const sourceAddress = await source.getAddress();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const scope = BigInt(sourceAddress);
    await family.setSource(sourceAddress);
    await family.setManager(hre.ethers.keccak256(hre.ethers.toBeHex(202n, 32)), 1, controller.address, true);
    let serial = 0n;
    const publish = async secrets => {
      const offset = serial++;
      const factLeaf = 10000n + offset, trustLeaf = 20000n + offset;
      const factCommitments = secrets.slice(0, 2).map((secret, role) => roleCommitment(role, secret));
      await source.publishFact(201n, 202n, controller.address, 1n, factLeaf, ...factCommitments,
        echo([factLeaf, ...factCommitments, chainId, scope, 201n, 202n, BigInt(controller.address), 1n, await lineage.root(0)]));
      const trustCommitment = roleCommitment(2, secrets[2]);
      await source.publishTrust(202n, controller.address, 1n, trustLeaf, trustCommitment,
        echo([trustLeaf, trustCommitment, chainId, scope, 202n, BigInt(controller.address), 1n, await lineage.root(1)]));
    };
    const revoke = async (roles, secrets) => family.revoke(sourceAddress, controller.address, roles, secrets);
    const histories = [[], [], []];
    for (let index = 0n; index < 40n; ++index) {
      const secrets = [100000n + index, 200000n + index, 300000n + index];
      await publish(secrets);
      await revoke([0, 1, 2], secrets);
      secrets.forEach((secret, role) => histories[role].push(secret));
    }
    const targetSecrets = [30000n, 40000n, 50000n];
    await publish(targetSecrets);
    const tags = targetSecrets.map((secret, role) => roleTag(role, secret));
    const signals = async (role, start, end, selectedNonce = nonce, selectedTag = tags[role]) => [
      chainId, scope, BigInt(role), selectedNonce, selectedTag, BigInt(start), BigInt(end),
      await source.revocationCheckpoint(role, start), await source.revocationCheckpoint(role, end),
    ];
    const prepare = async (role, start, end, selectedNonce = nonce, selectedTag = tags[role]) =>
      source.connect(stranger).prepareRoleScan(role, selectedNonce, selectedTag, start, end,
        echo(await signals(role, start, end, selectedNonce, selectedTag)));
    return { source, sourceAddress, family, lineage, controller, stranger, factory, verifierAddress,
      chainId, scope, histories, targetSecrets, tags, publish, revoke, signals, prepare };
  }
  const fixture = () => hre.networkHelpers.loadFixture(setup);

  it("authenticates every prefix and scopes genesis to the chain, source and role", async () => {
    const { source, factory, lineage, verifierAddress, chainId, scope, histories } = await fixture();
    expect(await source.MAX_REVOCATION_BATCH()).to.equal(32n);
    expect(await source.MAX_REVOCATION_TAIL()).to.equal(8n);
    expect(await source.SCAN_VERIFIER()).to.equal(verifierAddress);
    for (let role = 0; role < 3; ++role) {
      let digest = poseidon3([74300n + BigInt(role), chainId, scope]);
      expect(await source.revocationCheckpoint(role, 0)).to.equal(digest);
      for (let index = 0; index < histories[role].length; ++index) {
        digest = poseidon3([74310n + BigInt(role), digest, histories[role][index]]);
        expect(await source.revocationCheckpoint(role, index + 1)).to.equal(digest);
      }
      expect([...await source.getRevokedRolePage(role, 3, 5)]).to.deep.equal(histories[role].slice(3, 8));
    }
    const other = await factory.deploy(await lineage.getAddress(), verifierAddress, verifierAddress, verifierAddress);
    expect(await other.revocationCheckpoint(0, 0)).not.to.equal(await source.revocationCheckpoint(0, 0));
    await expect(factory.deploy(await lineage.getAddress(), verifierAddress, verifierAddress, hre.ethers.ZeroAddress))
      .to.be.revertedWithCustomError(source, "InvalidDependency");
    await expect(source.revocationCheckpoint(3, 0)).to.be.revertedWithCustomError(source, "InvalidRole");
    await expect(source.revocationCheckpoint(0, 41)).to.be.revertedWithCustomError(source, "InvalidScanProgress");
  });

  it("requires a contiguous bounded prefix and refuses gaps, overlaps, repeats and nonexistent ranges", async () => {
    const { source, tags, prepare, signals } = await fixture();
    for (const [start, end] of [[1, 2], [0, 0], [0, 33], [0, 41], [40, 39], [0, 1n << 64n]]) {
      await expect(source.prepareRoleScan(0, nonce, tags[0], start, end, "0x"))
        .to.be.revertedWithCustomError(source, "InvalidScanProgress");
    }
    await expect(prepare(0, 0, 32)).to.emit(source, "RoleScanPrepared").withArgs(0, nonce, tags[0], 0, 32);
    expect(await source.roleScanProgress(0, nonce, tags[0])).to.equal(32n);
    for (const [start, end] of [[0, 32], [31, 33], [33, 40], [32, 32]]) {
      await expect(source.prepareRoleScan(0, nonce, tags[0], start, end, "0x"))
        .to.be.revertedWithCustomError(source, "InvalidScanProgress");
    }
    await source.prepareRoleScan(0, nonce, tags[0], 32, 40, echo(await signals(0, 32, 40)));
    expect(await source.roleScanProgress(0, nonce, tags[0])).to.equal(40n);
    expect(await source.isRoleRevoked(0, nonce, tags[0])).to.equal(false);
  });

  it("binds all nine proof coordinates and isolates role, nonce, tag and source progress", async () => {
    const { source, sourceAddress, family, factory, lineage, verifierAddress, tags, signals, prepare } = await fixture();
    const statement = await signals(0, 0, 32);
    for (let index = 0; index < statement.length; ++index) {
      const changed = [...statement];
      changed[index] += 1n;
      await expect(source.prepareRoleScan(0, nonce, tags[0], 0, 32, echo(changed)))
        .to.be.revertedWithCustomError(source, "InvalidProof");
      expect(await source.roleScanProgress(0, nonce, tags[0])).to.equal(0n);
    }
    await expect(source.prepareRoleScan(1, nonce, tags[0], 0, 32, echo(statement)))
      .to.be.revertedWithCustomError(source, "InvalidProof");
    await expect(source.prepareRoleScan(0, nonce + 1n, tags[0], 0, 32, echo(statement)))
      .to.be.revertedWithCustomError(source, "InvalidProof");
    await expect(source.prepareRoleScan(0, nonce, tags[0] + 1n, 0, 32, echo(statement)))
      .to.be.revertedWithCustomError(source, "InvalidProof");
    await prepare(0, 0, 32);
    expect(await source.roleScanProgress(1, nonce, tags[0])).to.equal(0n);
    expect(await source.roleScanProgress(0, nonce + 1n, tags[0])).to.equal(0n);
    expect(await source.roleScanProgress(0, nonce, tags[0] + 1n)).to.equal(0n);
    const other = await factory.deploy(await lineage.getAddress(), verifierAddress, verifierAddress, verifierAddress);
    expect(await other.roleScanProgress(0, nonce, tags[0])).to.equal(0n);
    await family.setSource(await other.getAddress());
    await expect(source.prepareRoleScan(0, nonce, tags[0], 32, 40, "0x"))
      .to.be.revertedWithCustomError(source, "InactiveSource");
    await family.setSource(sourceAddress);
  });

  it("caps unprepared work and distinguishes stale preparation from valid or revoked qualification", async () => {
    const { source, tags, prepare, publish, revoke } = await fixture();
    for (let role = 0; role < 3; ++role) {
      await expect(source.isRoleRevoked(role, nonce, tags[role]))
        .to.be.revertedWithCustomError(source, "RevocationStateNotPrepared").withArgs(role, 0, 40);
      await prepare(role, 0, 32);
      expect(await source.isRoleRevoked(role, nonce, tags[role])).to.equal(false);
    }
    const unrelated = [400000n, 500000n, 600000n];
    await publish(unrelated);
    await revoke([0], [unrelated[0]]);
    await expect(source.isRoleRevoked(0, nonce, tags[0]))
      .to.be.revertedWithCustomError(source, "RevocationStateNotPrepared").withArgs(0, 32, 41);
    expect(await source.isRoleRevoked(1, nonce, tags[1])).to.equal(false);
    await prepare(0, 32, 33);
    expect(await source.isRoleRevoked(0, nonce, tags[0])).to.equal(false);
  });

  it("checks a target revocation added after proof preparation immediately, for each role", async () => {
    const { source, tags, targetSecrets, prepare, signals, revoke } = await fixture();
    for (let role = 0; role < 3; ++role) await prepare(role, 0, 32);
    const pending = await Promise.all([0, 1, 2].map(async role => echo(await signals(role, 32, 40))));
    await revoke([0, 1, 2], targetSecrets);
    for (let role = 0; role < 3; ++role) {
      // A previously authenticated historical prefix remains usable for preparation only.
      await source.prepareRoleScan(role, nonce, tags[role], 32, 40, pending[role]);
      expect(await source.roleScanProgress(role, nonce, tags[role])).to.equal(40n);
      expect(await source.revokedRoleCount(role)).to.equal(41n);
      expect(await source.isRoleRevoked(role, nonce, tags[role])).to.equal(true);
    }
  });

  it("rolls back new log digests and role state with any failed revocation or lineage mutation", async () => {
    const { source, sourceAddress, family, lineage, controller, targetSecrets } = await fixture();
    const previous = await Promise.all([0, 1, 2].map(role => source.revocationCheckpoint(role, 40)));
    await expect(family.revoke(sourceAddress, controller.address, [0, 1], [targetSecrets[0], 999999n]))
      .to.be.revertedWithCustomError(source, "UnknownRole");
    await expect(family.connect(controller).revokeAndEndorse(sourceAddress, await lineage.getAddress(), 201n,
      controller.address, [0, 1], targetSecrets.slice(0, 2), true)).to.be.revertedWith("mock mutation failure");
    expect(await lineage.root(0)).to.equal(1001n);
    for (let role = 0; role < 3; ++role) {
      expect(await source.revokedRoleCount(role)).to.equal(40n);
      expect(await source.revocationCheckpoint(role, 40)).to.equal(previous[role]);
      expect((await source.roleRecord(role, roleCommitment(role, targetSecrets[role]))).revoked).to.equal(false);
      await expect(source.revocationCheckpoint(role, 41)).to.be.revertedWithCustomError(source, "InvalidScanProgress");
    }
  });

  it("rejects malformed role and field inputs without changing progress", async () => {
    const { source, tags } = await fixture();
    await expect(source.prepareRoleScan(3, nonce, tags[0], 0, 1, "0x"))
      .to.be.revertedWithCustomError(source, "InvalidRole");
    await expect(source.isRoleRevoked(3, nonce, tags[0])).to.be.revertedWithCustomError(source, "InvalidRole");
    await expect(source.roleScanProgress(3, nonce, tags[0])).to.be.revertedWithCustomError(source, "InvalidRole");
    for (const [selectedNonce, selectedTag] of [[0n, tags[0]], [nonce, 0n], [await source.SNARK_SCALAR_FIELD(), tags[0]]]) {
      await expect(source.prepareRoleScan(0, selectedNonce, selectedTag, 0, 1, "0x"))
        .to.be.revertedWithCustomError(source, "InvalidField");
      await expect(source.isRoleRevoked(0, selectedNonce, selectedTag))
        .to.be.revertedWithCustomError(source, "InvalidField");
      await expect(source.roleScanProgress(0, selectedNonce, selectedTag))
        .to.be.revertedWithCustomError(source, "InvalidField");
    }
    expect(await source.roleScanProgress(0, nonce, tags[0])).to.equal(0n);
  });
});
