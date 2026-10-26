import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2 } from "poseidon-lite";
import {
  addPerson,
  deployLineageIndex,
  computeProfileIdentityCommitment,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

// Real DeepFamily proxy, real lineage index and source. Person/source attestation proofs are
// explicit test stubs: this suite verifies source hooks, authorization and atomic state changes.
describe("Qualification hooks in the actual lineage", function () {
  this.timeout(180_000);
  const abi = hre.ethers.AbiCoder.defaultAbiCoder();
  const encoded = (signals) => abi.encode(["uint256[]"], [signals]);
  const roleCommitment = (role, secret) => poseidon2([74201n + BigInt(role), secret]);
  const roleIndex = (role, secret) => poseidon2([74321n + BigInt(role), secret]);

  async function setup() {
    const [owner] = await hre.ethers.getSigners();
    const token = await hre.ethers.deployContract("DeepFamilyToken");
    const poseidonT3 = await hre.ethers.deployContract("PoseidonT3");
    const poseidonT4 = await hre.ethers.deployContract("PoseidonT4");
    const poseidonT5 = await hre.ethers.deployContract("PoseidonT5");
    const ageGate = await hre.ethers.deployContract("AdultAgeGate");
    const familyFactory = await hre.ethers.getContractFactory("DeepFamily", {
      libraries: { PoseidonT5: await poseidonT5.getAddress(), AdultAgeGate: await ageGate.getAddress() },
    });
    const implementation = await familyFactory.deploy();
    const proxy = await hre.ethers.deployContract("UUPSProxy", [await implementation.getAddress(),
      familyFactory.interface.encodeFunctionData("initialize", [await token.getAddress(), owner.address])]);
    const deepFamily = familyFactory.attach(await proxy.getAddress());
    await token.initialize(await deepFamily.getAddress());
    const archive = await hre.ethers.deployContract("DeepFamilyArchive", [await deepFamily.getAddress()]);
    await deepFamily.setArchive(await archive.getAddress());
    const lineageIndex = await deployLineageIndex(hre.ethers, await deepFamily.getAddress(), await poseidonT5.getAddress());
    await deepFamily.setLineageIndex(await lineageIndex.getAddress());
    const deployed = { deepFamily, token, lineageIndex, poseidonT3, poseidonT4 };
    const [manager, endorser, outsider] = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    const parent = makeTestPerson(" Hook Parent", { derivedSecretField: 80401n });
    const mother = makeTestPerson(" Hook Mother", { derivedSecretField: 80402n, gender: 2 });
    const child = makeTestPerson(" Hook Child", { derivedSecretField: 80403n });
    const parentHash = await addPerson(hre.ethers, deepFamily, manager, undefined, { person: parent });
    const childHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
      person: child, fatherPerson: parent, motherPerson: mother,
    });
    const childIdentity = computeProfileIdentityCommitment(hre.ethers, child);
    const parentIdentity = computeProfileIdentityCommitment(hre.ethers, parent);
    await deepFamily.addTrustedEndorser(parentHash, 1, endorser.address);
    const fee = await token.recentReward();
    await token.transfer(endorser.address, fee);
    await token.connect(endorser).approve(await deepFamily.getAddress(), fee);
    await deepFamily.connect(endorser).endorseVersion(childHash, 1);
    const verifier = await hre.ethers.deployContract("FixedProofVerifierMock");
    const source = await (await hre.ethers.getContractFactory("EligibilitySource", {
      libraries: {
        PoseidonT3: await poseidonT3.getAddress(),
      },
    })).deploy(await lineageIndex.getAddress(), await verifier.getAddress(), await verifier.getAddress());
    await deepFamily.setEligibilitySource(await source.getAddress());
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const scope = BigInt(await source.getAddress());
    const secrets = [81001n, 81002n, 81003n];
    const factArgs = [childIdentity, parentIdentity, endorser.address, 1n, 82001n,
      roleCommitment(0, secrets[0]), roleCommitment(1, secrets[1])];
    await source.connect(endorser).publishFact(...factArgs, encoded([
      ...factArgs.slice(4), chainId, scope, childIdentity, parentIdentity,
      BigInt(endorser.address), 1n, await lineageIndex.root(0),
    ]));
    const trustArgs = [parentIdentity, endorser.address, 1n, 82002n, roleCommitment(2, secrets[2])];
    await source.connect(manager).publishTrust(...trustArgs, encoded([
      ...trustArgs.slice(3), chainId, scope, parentIdentity, BigInt(endorser.address),
      1n, await lineageIndex.root(1),
    ]));
    const cancel = (hash = childHash) => deepFamily.interface.encodeFunctionData("cancelEndorsement", [hash]);
    const remove = (hash = parentHash, account = endorser.address) =>
      deepFamily.interface.encodeFunctionData("removeTrustedEndorser", [hash, 1, account]);
    return { ...deployed, manager, endorser, outsider, source, childHash, parentHash,
      childIdentity, parentIdentity, secrets, cancel, remove };
  }

  it("activates only once through the owner and blocks unaccompanied existing mutations", async () => {
    const { deepFamily, lineageIndex, source, outsider, endorser, childHash, parentHash, secrets } = await setup();
    expect(await deepFamily.eligibilitySource()).to.equal(await source.getAddress());
    await expect(deepFamily.connect(outsider).setEligibilitySource(await source.getAddress()))
      .to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");
    await expect(deepFamily.setEligibilitySource(await source.getAddress()))
      .to.be.revertedWithCustomError(deepFamily, "InvalidEligibilityMutation");
    await expect(deepFamily.connect(endorser).cancelEndorsement(childHash))
      .to.be.revertedWithCustomError(source, "MissingRoleRevocation")
      .withArgs(0, roleCommitment(0, secrets[0]));
    await expect(deepFamily.removeTrustedEndorser(parentHash, 1, endorser.address))
      .to.be.revertedWithCustomError(source, "MissingRoleRevocation")
      .withArgs(2, roleCommitment(2, secrets[2]));
    expect(await deepFamily.endorsedVersionIndex(childHash, endorser.address)).to.equal(1n);
    expect(await deepFamily.trustedEndorserOf(parentHash, 1, endorser.address)).to.equal(true);
  });

  it("preserves the original actor through the proxy and atomically cancels the actual endorsement", async () => {
    const { deepFamily, lineageIndex, source, endorser, outsider, childHash, parentHash, secrets, cancel } = await setup();
    await expect(deepFamily.connect(outsider).withEligibilityRevocations([0, 1], secrets.slice(0, 2), cancel()))
      .to.be.revertedWithCustomError(source, "UnauthorizedCaller");
    await expect(deepFamily.connect(endorser).withEligibilityRevocations([0, 1], secrets.slice(0, 2), cancel()))
      .to.emit(deepFamily, "EndorsementCancelled");
    expect(await deepFamily.endorsedVersionIndex(childHash, endorser.address)).to.equal(0n);
    expect([...(await lineageIndex.getEndorsementMetadata(childHash, endorser.address))]).to.deep.equal([0n, 0n]);
    expect(await source.isRoleRevoked(0, roleIndex(0, secrets[0]))).to.equal(true);
    expect(await source.isRoleRevoked(1, roleIndex(1, secrets[1]))).to.equal(true);
    expect(await source.isRoleRevoked(2, roleIndex(2, secrets[2]))).to.equal(false);
    expect(await deepFamily.trustedEndorserOf(parentHash, 1, endorser.address)).to.equal(true);
  });

  it("rolls back partial revocations and failed mutations together with all lineage state", async () => {
    const { deepFamily, lineageIndex, source, endorser, childHash, parentHash, secrets, cancel, remove } = await setup();
    const rootBefore = await lineageIndex.root(0);
    const checkpointBefore = await lineageIndex.currentCheckpointId();
    await expect(deepFamily.connect(endorser).withEligibilityRevocations([0], [secrets[0]], cancel()))
      .to.be.revertedWithCustomError(source, "MissingRoleRevocation")
      .withArgs(1, roleCommitment(1, secrets[1]));
    // The actor may revoke these roles, but is not the parent/version's trust manager.
    await expect(deepFamily.connect(endorser).withEligibilityRevocations([0, 1], secrets.slice(0, 2), remove()))
      .to.be.revertedWithCustomError(deepFamily, "MustBeTrustedEndorserManager");
    // The selector is allowed, but the original actor never endorsed this parent.
    await expect(deepFamily.connect(endorser).withEligibilityRevocations([0, 1], secrets.slice(0, 2), cancel(parentHash)))
      .to.be.revertedWithCustomError(deepFamily, "NotEndorsed");
    expect(await source.revokedRoleCount(0)).to.equal(0n);
    expect(await source.revokedRoleCount(1)).to.equal(0n);
    expect(await source.isRoleRevoked(0, roleIndex(0, secrets[0]))).to.equal(false);
    expect(await deepFamily.endorsedVersionIndex(childHash, endorser.address)).to.equal(1n);
    expect(await lineageIndex.root(0)).to.equal(rootBefore);
    expect(await lineageIndex.currentCheckpointId()).to.equal(checkpointBefore);
  });

  it("atomically removes actual trusted status and rejects arbitrary delegated selectors", async () => {
    const { deepFamily, lineageIndex, source, manager, endorser, parentHash, secrets, remove } = await setup();
    const rootBefore = await lineageIndex.root(1);
    const arbitrary = deepFamily.interface.encodeFunctionData("addTrustedEndorser", [parentHash, 1, manager.address]);
    await expect(deepFamily.withEligibilityRevocations([2], [secrets[2]], arbitrary))
      .to.be.revertedWithCustomError(deepFamily, "InvalidEligibilityMutation");
    await expect(deepFamily.withEligibilityRevocations([2], [secrets[2]], "0x"))
      .to.be.revertedWithCustomError(deepFamily, "InvalidEligibilityMutation");
    expect(await source.revokedRoleCount(2)).to.equal(0n);
    await deepFamily.connect(manager).withEligibilityRevocations([2], [secrets[2]], remove());
    expect(await source.isRoleRevoked(2, roleIndex(2, secrets[2]))).to.equal(true);
    expect(await deepFamily.trustedEndorserOf(parentHash, 1, endorser.address)).to.equal(false);
    expect(await lineageIndex.root(1)).not.to.equal(rootBefore);
  });

  it("allows unrelated lineage updates and explicit controller withdrawal", async () => {
    const { deepFamily, source, outsider, endorser, parentHash, secrets } = await setup();
    await deepFamily.addTrustedEndorser(parentHash, 1, outsider.address);
    await deepFamily.removeTrustedEndorser(parentHash, 1, outsider.address);
    expect(await source.revokedRoleCount(0)).to.equal(0n);
    await deepFamily.connect(endorser).revokeEligibilityRoles([0], [secrets[0]]);
    expect(await source.isRoleRevoked(0, roleIndex(0, secrets[0]))).to.equal(true);
  });
});
