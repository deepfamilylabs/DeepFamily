import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("UUPS upgradeability", function () {
  this.timeout(60_000);

  const deployUpgradeImplementation = async (poseidonT5, adultAgeGate) => {
    const Upgrade = await hre.ethers.getContractFactory("DeepFamilyUpgradeMock", {
      libraries: {
        PoseidonT5: await poseidonT5.getAddress(),
        AdultAgeGate: await adultAgeGate.getAddress(),
      },
    });
    const impl = await Upgrade.deploy();
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

    const upgradeImplementation = await deployUpgradeImplementation(poseidonT5, adultAgeGate);
    await (
      await deepFamily.upgradeToAndCall(await upgradeImplementation.getAddress(), "0x")
    ).wait();

    const upgraded = await hre.ethers.getContractAt("DeepFamilyUpgradeMock", proxyAddress);

    // Pre-existing storage is preserved across the upgrade.
    expect(await upgraded.protocolEndorsementFeeBps()).to.equal(feeBefore);
    expect(await upgraded.owner()).to.equal(ownerBefore);
    expect(await upgraded.name()).to.equal(nameBefore);

    // New behavior + new storage works.
    expect(await upgraded.version()).to.equal("upgraded");
    await (await upgraded.setNewValue(42)).wait();
    expect(await upgraded.newValue()).to.equal(42n);
  });

  it("rejects upgrades from a non-owner", async () => {
    const { deepFamily, poseidonT5, adultAgeGate } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, other] = await hre.ethers.getSigners();
    const upgradeImplementation = await deployUpgradeImplementation(poseidonT5, adultAgeGate);

    await expect(
      deepFamily.connect(other).upgradeToAndCall(await upgradeImplementation.getAddress(), "0x"),
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
    const impl = await deployUpgradeImplementation(poseidonT5, adultAgeGate);

    await expect(
      impl.initialize(await token.getAddress(), await owner.getAddress()),
    ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });

  it("upgrades the main contract through a timelock governance owner", async () => {
    const { deepFamily, poseidonT5, adultAgeGate } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [deployer, roleHolder] = await hre.ethers.getSigners();
    const proxyAddress = await deepFamily.getAddress();

    // The dedicated multisig integration test covers threshold approval; this test isolates the
    // UUPS schedule/execute path with one local role-holder account.
    const minDelay = 3600;
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, await roleHolder.getAddress());
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();

    // Hand upgrade authority to the timelock; the deployer is no longer owner.
    await (await deepFamily.transferOwnership(timelockAddress)).wait();
    expect(await deepFamily.owner()).to.equal(timelockAddress);

    const upgradeImplementation = await deployUpgradeImplementation(poseidonT5, adultAgeGate);
    const upgradeImplementationAddress = await upgradeImplementation.getAddress();

    // The ex-owner can no longer upgrade directly.
    await expect(
      deepFamily.connect(deployer).upgradeToAndCall(upgradeImplementationAddress, "0x"),
    ).to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");

    const data = deepFamily.interface.encodeFunctionData("upgradeToAndCall", [
      upgradeImplementationAddress,
      "0x",
    ]);
    const salt = hre.ethers.id("upgrade-main");

    // Schedule the upgrade through the timelock.
    await (
      await timelock
        .connect(roleHolder)
        .schedule(proxyAddress, 0, data, hre.ethers.ZeroHash, salt, minDelay)
    ).wait();

    // Executing before the delay elapses must fail.
    await expect(
      timelock.connect(roleHolder).execute(proxyAddress, 0, data, hre.ethers.ZeroHash, salt),
    ).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    // Advance past the timelock delay, then execute.
    await hre.networkHelpers.time.increase(minDelay + 1);
    await (
      await timelock.connect(roleHolder).execute(proxyAddress, 0, data, hre.ethers.ZeroHash, salt)
    ).wait();

    const upgraded = await hre.ethers.getContractAt("DeepFamilyUpgradeMock", proxyAddress);
    // New behavior + storage works, owner is still the timelock, and prior storage survives.
    expect(await upgraded.version()).to.equal("upgraded");
    await (await upgraded.setNewValue(7)).wait();
    expect(await upgraded.newValue()).to.equal(7n);
    expect(await upgraded.owner()).to.equal(timelockAddress);
    expect(await upgraded.name()).to.equal("DeepFamily");
  });
});
