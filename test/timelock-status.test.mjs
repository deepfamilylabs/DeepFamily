import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import { action as timelockStatus } from "../tasks/timelock-status.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("timelock-status task", function () {
  this.timeout(60_000);

  const withRecordedTarget = async ({ deepFamily, token }, callback) => {
    const originalCwd = process.cwd();
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-timelock-status-"));
    const networkName = "timelock-status-test";
    const deploymentDirectory = path.join(temporaryRoot, "deployments", networkName);
    await fs.mkdir(deploymentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(deploymentDirectory, "DeepFamily.json"),
      JSON.stringify({ address: await deepFamily.getAddress() }),
    );
    await fs.writeFile(
      path.join(deploymentDirectory, "DeepFamilyToken.json"),
      JSON.stringify({ address: await token.getAddress() }),
    );
    const taskHre = {
      artifacts: hre.artifacts,
      network: {
        connect: async () => ({ ethers: hre.ethers, networkName }),
      },
    };

    try {
      process.chdir(temporaryRoot);
      return await callback(taskHre);
    } finally {
      process.chdir(originalCwd);
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  };

  const deployOwnedTarget = async ({ deepFamily, token }, governanceHolder, minDelay = 3600) => {
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, governanceHolder);
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();
    await (await deepFamily.transferOwnership(timelockAddress)).wait();
    return { deepFamily, token, timelock };
  };

  const statusArgs = (overrides = {}) => ({
    target: "main",
    contractName: "GovernanceTimelock",
    operationId: "",
    ...overrides,
  });

  it("rejects removed governance environment variables before connecting", async () => {
    const removedVariables = {
      GOVERNANCE_MULTISIG: "GOVERNANCE_SAFE_ADDRESS",
      GOVERNANCE_OWNER: "GOVERNANCE_TIMELOCK_ADDRESS",
      GOVERNANCE_MULTISIG_PROFILE: "GOVERNANCE_SAFE_PROFILE",
    };

    for (const [removedName, replacementName] of Object.entries(removedVariables)) {
      const originalValue = process.env[removedName];
      process.env[removedName] = "legacy-value";
      let connected = false;
      try {
        let error;
        try {
          await timelockStatus(statusArgs(), {
            network: {
              connect: async () => {
                connected = true;
                throw new Error("should not connect");
              },
            },
          });
        } catch (caught) {
          error = caught;
        }
        expect(error, `expected ${removedName} rejection`).to.be.an("error");
        expect(error.message).to.include(`${removedName} has been removed`);
        expect(error.message).to.include(`use ${replacementName} instead`);
        expect(connected).to.equal(false);
      } finally {
        if (originalValue === undefined) delete process.env[removedName];
        else process.env[removedName] = originalValue;
      }
    }
  });

  it("reports the exact self-admin roles and the multisig threshold and owners", async () => {
    const integrated = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, ownerA, ownerB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await ownerA.getAddress(), await ownerB.getAddress());
    await multisig.waitForDeployment();
    const { deepFamily, token, timelock } = await deployOwnedTarget(
      integrated,
      await multisig.getAddress(),
      7200,
    );

    const report = await withRecordedTarget({ deepFamily, token }, (taskHre) =>
      timelockStatus(statusArgs(), taskHre),
    );

    expect(report.healthy).to.equal(true);
    expect(report.issues).to.deep.equal([]);
    expect(report.timelock.address).to.equal(await timelock.getAddress());
    expect(report.timelock.artifact).to.equal("GovernanceTimelock");
    expect(report.timelock.runtimeMatchesArtifact).to.equal(true);
    expect(report.timelock.minDelay).to.equal(7200n);
    expect(report.timelock.roles.admin.members).to.deep.equal([await timelock.getAddress()]);
    for (const roleName of ["proposer", "canceller", "executor"]) {
      expect(report.timelock.roles[roleName].members).to.deep.equal([await multisig.getAddress()]);
    }
    expect(report.multisig).to.deep.include({
      address: await multisig.getAddress(),
      hasCode: true,
      threshold: 2n,
    });
    expect(report.multisig.owners).to.deep.equal([
      await ownerA.getAddress(),
      await ownerB.getAddress(),
    ]);
    expect(report.token).to.deep.include({
      address: await token.getAddress(),
      owner: hre.ethers.ZeroAddress,
      configuredToken: await token.getAddress(),
      configuredMain: await deepFamily.getAddress(),
      ownerRetired: true,
      wiringAligned: true,
    });
    expect(report.operation).to.equal(null);
  });

  it("reports a scheduled operation and its remaining delay", async () => {
    const integrated = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, ownerA, ownerB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await ownerA.getAddress(), await ownerB.getAddress());
    await multisig.waitForDeployment();
    const minDelay = 3600n;
    const { deepFamily, token, timelock } = await deployOwnedTarget(
      integrated,
      await multisig.getAddress(),
      minDelay,
    );

    const targetAddress = await deepFamily.getAddress();
    const timelockAddress = await timelock.getAddress();
    const salt = hre.ethers.id("timelock-status-pending-operation");
    const operationId = await timelock.hashOperation(
      targetAddress,
      0,
      "0x",
      hre.ethers.ZeroHash,
      salt,
    );
    const scheduleData = timelock.interface.encodeFunctionData("schedule", [
      targetAddress,
      0,
      "0x",
      hre.ethers.ZeroHash,
      salt,
      minDelay,
    ]);
    const transactionId = await multisig.transactionCount();
    await (await multisig.connect(ownerA).submit(timelockAddress, 0, scheduleData)).wait();
    await (await multisig.connect(ownerB).approveAndExecute(transactionId)).wait();

    const report = await withRecordedTarget({ deepFamily, token }, (taskHre) =>
      timelockStatus(statusArgs({ operationId }), taskHre),
    );

    expect(report.healthy).to.equal(true);
    expect(report.operation).to.include({
      id: operationId,
      registered: true,
      pending: true,
      ready: false,
      done: false,
      state: "waiting",
    });
    expect(report.operation.timestamp).to.be.greaterThan(0n);
    expect(report.operation.remainingSeconds).to.be.greaterThan(0n);
    expect(report.operation.remainingSeconds).to.be.at.most(minDelay);
  });

  it("marks an inspectable 1-of-1 wallet as dangerous", async () => {
    const integrated = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, walletOwner] = await hre.ethers.getSigners();
    const Wallet = await hre.ethers.getContractFactory("SingleSignerWalletMock");
    const wallet = await Wallet.deploy(await walletOwner.getAddress());
    await wallet.waitForDeployment();
    const { deepFamily, token } = await deployOwnedTarget(integrated, await wallet.getAddress());

    const report = await withRecordedTarget({ deepFamily, token }, (taskHre) =>
      timelockStatus(statusArgs(), taskHre),
    );

    expect(report.healthy).to.equal(false);
    expect(report.multisig.threshold).to.equal(1n);
    expect(report.issues.join("\n")).to.match(/requires at least 2/i);
  });

  it("marks a non-retired token bootstrap owner as unhealthy", async () => {
    const integrated = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [deployer, ownerA, ownerB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await ownerA.getAddress(), await ownerB.getAddress());
    await multisig.waitForDeployment();
    const { deepFamily, token, timelock } = await deployOwnedTarget(
      integrated,
      await multisig.getAddress(),
    );

    // Replace only the local test runtime with the storage-compatible harness so this negative
    // case can emulate a legacy token whose bootstrap owner was never retired.
    const Harness = await hre.ethers.getContractFactory("DeepFamilyTokenHarness");
    const harness = await Harness.deploy();
    await harness.waitForDeployment();
    const harnessCode = await hre.ethers.provider.getCode(await harness.getAddress());
    await hre.ethers.provider.send("hardhat_setCode", [await token.getAddress(), harnessCode]);
    const unsafeToken = await hre.ethers.getContractAt(
      "DeepFamilyTokenHarness",
      await token.getAddress(),
    );
    await unsafeToken.forceBootstrapOwnerForTest(await deployer.getAddress());

    const report = await withRecordedTarget({ deepFamily, token: unsafeToken }, (taskHre) =>
      timelockStatus(statusArgs(), taskHre),
    );

    expect(report.healthy).to.equal(false);
    expect(report.token).to.deep.include({
      owner: await deployer.getAddress(),
      ownerRetired: false,
      wiringAligned: true,
    });
    expect(report.timelock.address).to.equal(await timelock.getAddress());
    expect(report.issues.join("\n")).to.match(/DeepFamilyToken bootstrap owner .* still active/i);
  });

  it("rejects an invalid operation ID", async () => {
    const integrated = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, ownerA, ownerB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await ownerA.getAddress(), await ownerB.getAddress());
    await multisig.waitForDeployment();
    const { deepFamily, token } = await deployOwnedTarget(integrated, await multisig.getAddress());

    let error;
    try {
      await withRecordedTarget({ deepFamily, token }, (taskHre) =>
        timelockStatus(statusArgs({ operationId: "0x1234" }), taskHre),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error, "expected invalid operation ID rejection").to.be.an("error");
    expect(error.message).to.match(/32-byte timelock operation ID/i);
  });
});
