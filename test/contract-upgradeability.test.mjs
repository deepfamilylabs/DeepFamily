import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("UUPS upgradeability", function () {
  this.timeout(60_000);

  const deployV2Impl = async (poseidonT5, adultAgeGate) => {
    const V2 = await hre.ethers.getContractFactory("DeepFamilyV2Mock", {
      libraries: {
        PoseidonT5: await poseidonT5.getAddress(),
        AdultAgeGate: await adultAgeGate.getAddress(),
      },
    });
    const impl = await V2.deploy();
    await impl.waitForDeployment();
    return impl;
  };

  it("initializes the main proxy with the expected owner", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [owner] = await hre.ethers.getSigners();

    expect(await deepFamily.owner()).to.equal(await owner.getAddress());
  });

  it("upgrades the main contract while preserving storage and adding behavior", async () => {
    const { deepFamily, poseidonT5, adultAgeGate } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const proxyAddress = await deepFamily.getAddress();

    const feeBefore = await deepFamily.protocolEndorsementFeeBps();
    const ownerBefore = await deepFamily.owner();
    const nameBefore = await deepFamily.name();

    const v2Impl = await deployV2Impl(poseidonT5, adultAgeGate);
    await (await deepFamily.upgradeToAndCall(await v2Impl.getAddress(), "0x")).wait();

    const v2 = await hre.ethers.getContractAt("DeepFamilyV2Mock", proxyAddress);

    // Pre-existing storage is preserved across the upgrade.
    expect(await v2.protocolEndorsementFeeBps()).to.equal(feeBefore);
    expect(await v2.owner()).to.equal(ownerBefore);
    expect(await v2.name()).to.equal(nameBefore);

    // New behavior + new storage works.
    expect(await v2.version()).to.equal("V2");
    await (await v2.setNewValue(42)).wait();
    expect(await v2.newValue()).to.equal(42n);
  });

  it("rejects upgrades from a non-owner", async () => {
    const { deepFamily, poseidonT5, adultAgeGate } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, other] = await hre.ethers.getSigners();
    const v2Impl = await deployV2Impl(poseidonT5, adultAgeGate);

    await expect(
      deepFamily.connect(other).upgradeToAndCall(await v2Impl.getAddress(), "0x"),
    ).to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");
  });

  it("cannot re-initialize the proxy", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const tokenAddr = await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT();

    await expect(
      deepFamily.initialize(tokenAddr, await deepFamily.owner()),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidInitialization");
  });

  it("disables initializers on the implementation contract", async () => {
    const { poseidonT5, adultAgeGate, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [owner] = await hre.ethers.getSigners();
    const impl = await deployV2Impl(poseidonT5, adultAgeGate);

    await expect(
      impl.initialize(await token.getAddress(), await owner.getAddress()),
    ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });

  it("upgrades the main contract through a timelock governance owner", async () => {
    const { deepFamily, poseidonT5, adultAgeGate } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [deployer, member1, member2] = await hre.ethers.getSigners();
    const proxyAddress = await deepFamily.getAddress();

    // A timelock whose proposer/executor roles are held by multiple member EOAs, standing in
    // for a multisig's signers. minDelay enforces the governance waiting period.
    const minDelay = 3600;
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(
      minDelay,
      [await member1.getAddress(), await member2.getAddress()],
      [await member1.getAddress(), await member2.getAddress()],
      hre.ethers.ZeroAddress,
    );
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();

    // Hand upgrade authority to the timelock; the deployer is no longer owner.
    await (await deepFamily.transferOwnership(timelockAddress)).wait();
    expect(await deepFamily.owner()).to.equal(timelockAddress);

    const v2Impl = await deployV2Impl(poseidonT5, adultAgeGate);
    const v2ImplAddress = await v2Impl.getAddress();

    // The ex-owner can no longer upgrade directly.
    await expect(
      deepFamily.connect(deployer).upgradeToAndCall(v2ImplAddress, "0x"),
    ).to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");

    const data = deepFamily.interface.encodeFunctionData("upgradeToAndCall", [v2ImplAddress, "0x"]);
    const salt = hre.ethers.id("upgrade-main-v2");

    // Schedule the upgrade through the timelock (member1 holds PROPOSER_ROLE).
    await (
      await timelock
        .connect(member1)
        .schedule(proxyAddress, 0, data, hre.ethers.ZeroHash, salt, minDelay)
    ).wait();

    // Executing before the delay elapses must fail.
    await expect(
      timelock.connect(member2).execute(proxyAddress, 0, data, hre.ethers.ZeroHash, salt),
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    // Advance past the timelock delay, then execute (member2 holds EXECUTOR_ROLE).
    await hre.networkHelpers.time.increase(minDelay + 1);
    await (
      await timelock.connect(member2).execute(proxyAddress, 0, data, hre.ethers.ZeroHash, salt)
    ).wait();

    const v2 = await hre.ethers.getContractAt("DeepFamilyV2Mock", proxyAddress);
    // New behavior + storage works, owner is still the timelock, and prior storage survives.
    expect(await v2.version()).to.equal("V2");
    await (await v2.setNewValue(7)).wait();
    expect(await v2.newValue()).to.equal(7n);
    expect(await v2.owner()).to.equal(timelockAddress);
    expect(await v2.name()).to.equal("DeepFamily");
  });
});
