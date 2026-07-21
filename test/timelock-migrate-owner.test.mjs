import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import { action as migrateOwner } from "../tasks/timelock-migrate-owner.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  addPerson,
  computeProfileIdentityCommitment,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

describe("timelock-migrate-owner task", function () {
  this.timeout(90_000);

  const artifactArgs = {
    // Use two independently resolved artifact identifiers even though this test migration keeps
    // the same runtime. A real V1 -> V2 migration supplies two retained versioned artifacts here.
    oldContractName: "contracts/governance/GovernanceTimelock.sol:GovernanceTimelock",
    newContractName: "GovernanceTimelock",
    proxyContractName: "UUPSProxy",
    deepFamilyContractName: "DeepFamily",
    tokenContractName: "DeepFamilyToken",
  };

  const captureError = async (operation) => {
    try {
      await operation();
    } catch (error) {
      return error;
    }
    return undefined;
  };

  const deployTwoOfTwo = async (ownerA, ownerB) => {
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await ownerA.getAddress(), await ownerB.getAddress());
    await multisig.waitForDeployment();
    return multisig;
  };

  const deployTimelockWithMultisig = async (delay, ownerA, ownerB) => {
    const multisig = await deployTwoOfTwo(ownerA, ownerB);
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(delay, await multisig.getAddress());
    await timelock.waitForDeployment();
    return { timelock, multisig };
  };

  const submitAndExecute = async (multisig, memberA, memberB, target, data) => {
    const id = await multisig.transactionCount();
    await (await multisig.connect(memberA).submit(target, 0, data)).wait();
    return (await multisig.connect(memberB).approveAndExecute(id)).wait();
  };

  const withDeployments = async (deployed, callback) => {
    const originalCwd = process.cwd();
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "deepfamily-timelock-owner-migration-"),
    );
    const networkName = "timelock-owner-migration-test";
    const deploymentDirectory = path.join(temporaryRoot, "deployments", networkName);
    await fs.mkdir(deploymentDirectory, { recursive: true });

    for (const [contractName, contract] of [
      ["DeepFamily", deployed.deepFamily],
      ["DeepFamilyToken", deployed.token],
      ["PoseidonT5", deployed.poseidonT5],
      ["AdultAgeGate", deployed.adultAgeGate],
    ]) {
      await fs.writeFile(
        path.join(deploymentDirectory, `${contractName}.json`),
        JSON.stringify({ address: await contract.getAddress() }),
      );
    }

    const ethersWithoutSigner = new Proxy(hre.ethers, {
      get(target, property, receiver) {
        if (property === "getSigners") return async () => [];
        return Reflect.get(target, property, receiver);
      },
    });
    const taskHre = {
      artifacts: hre.artifacts,
      network: {
        connect: async () => ({ ethers: ethersWithoutSigner, networkName }),
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

  const migrationArgs = async ({ oldTimelock, newTimelock, oldMultisig, newMultisig, phase }) => ({
    ...artifactArgs,
    phase,
    oldTimelock: await oldTimelock.getAddress(),
    newTimelock: await newTimelock.getAddress(),
    oldMultisig: await oldMultisig.getAddress(),
    newMultisig: await newMultisig.getAddress(),
    salt: "",
  });

  it("atomically migrates ownership and all execution-time DEEP through a real 2-of-2 multisig", async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily, token } = deployed;
    const [deployer, oldMemberA, oldMemberB, newMemberA, newMemberB] =
      await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    const fatherPerson = makeTestPerson("Timelock treasury migration father", {
      birthYear: 1960,
    });
    const motherPerson = makeTestPerson("Timelock treasury migration mother", {
      birthYear: 1962,
      gender: 2,
    });
    await addPerson(hre.ethers, deepFamily, deployer, null, {
      person: makeTestPerson("Timelock treasury migration funder"),
      fatherPerson,
      motherPerson,
      fatherIdentityCommitment: computeProfileIdentityCommitment(hre.ethers, fatherPerson),
      motherIdentityCommitment: computeProfileIdentityCommitment(hre.ethers, motherPerson),
    });
    const oldDelay = 60;
    const { timelock: oldTimelock, multisig: oldMultisig } = await deployTimelockWithMultisig(
      oldDelay,
      oldMemberA,
      oldMemberB,
    );
    const oldTimelockAddress = await oldTimelock.getAddress();
    await (await deepFamily.transferOwnership(oldTimelockAddress)).wait();
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);
    const scheduledBalance = hre.ethers.parseEther("10");
    const delayedBalance = hre.ethers.parseEther("7");
    await (await token.connect(deployer).transfer(oldTimelockAddress, scheduledBalance)).wait();

    const { timelock: newTimelock, multisig: newMultisig } = await deployTimelockWithMultisig(
      120,
      newMemberA,
      newMemberB,
    );
    const newTimelockAddress = await newTimelock.getAddress();
    const commonArgs = await migrationArgs({
      oldTimelock,
      newTimelock,
      oldMultisig,
      newMultisig,
      phase: "schedule",
    });

    const scheduled = await withDeployments(deployed, (taskHre) =>
      migrateOwner(commonArgs, taskHre),
    );
    expect(scheduled).to.include({ phase: "schedule", scheduled: false });
    expect(scheduled.calldata).to.match(/^0x[0-9a-f]+$/i);
    const scheduleTransaction = oldTimelock.interface.parseTransaction({
      data: scheduled.calldata,
    });
    expect(scheduleTransaction.name).to.equal("scheduleBatch");
    const [targets, values, payloads, predecessor, salt, delay] = scheduleTransaction.args;
    const targetList = [...targets];
    const valueList = [...values];
    const payloadList = [...payloads];
    expect(targetList).to.deep.equal([await deepFamily.getAddress(), oldTimelockAddress]);
    expect(valueList).to.deep.equal([0n, 0n]);
    expect(predecessor).to.equal(hre.ethers.ZeroHash);
    expect(salt).to.equal(scheduled.salt);
    expect(delay).to.equal(BigInt(oldDelay));
    const ownershipTransfer = deepFamily.interface.parseTransaction({ data: payloadList[0] });
    expect(ownershipTransfer.name).to.equal("transferOwnership");
    expect(ownershipTransfer.args[0]).to.equal(newTimelockAddress);
    const treasurySweep = oldTimelock.interface.parseTransaction({ data: payloadList[1] });
    expect(treasurySweep.name).to.equal("sweepERC20");
    expect([...treasurySweep.args]).to.deep.equal([await token.getAddress(), newTimelockAddress]);
    expect(
      await oldTimelock.hashOperationBatch(targetList, valueList, payloadList, predecessor, salt),
    ).to.equal(scheduled.operationId);
    await submitAndExecute(
      oldMultisig,
      oldMemberA,
      oldMemberB,
      oldTimelockAddress,
      scheduled.calldata,
    );
    expect(await oldTimelock.isOperation(scheduled.operationId)).to.equal(true);
    expect(await deepFamily.owner()).to.equal(oldTimelockAddress);
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);

    // This arrives after scheduling. The fixed operation has no encoded amount: sweepERC20 reads
    // the complete balance during execution so the governance-delay race cannot strand it.
    await (await token.connect(deployer).transfer(oldTimelockAddress, delayedBalance)).wait();
    expect(await token.balanceOf(oldTimelockAddress)).to.equal(scheduledBalance + delayedBalance);

    const earlyError = await withDeployments(deployed, (taskHre) =>
      captureError(() => migrateOwner({ ...commonArgs, phase: "execute" }, taskHre)),
    );
    expect(earlyError, "expected the old timelock delay to be enforced").to.be.an("error");
    expect(earlyError.message).to.match(/not ready yet/i);

    await hre.networkHelpers.time.increase(oldDelay + 1);
    const executed = await withDeployments(deployed, (taskHre) =>
      migrateOwner({ ...commonArgs, phase: "execute" }, taskHre),
    );
    expect(executed).to.include({ phase: "execute", executed: false });
    expect(executed.operationId).to.equal(scheduled.operationId);
    expect(executed.calldata).to.match(/^0x[0-9a-f]+$/i);
    const executeTransaction = oldTimelock.interface.parseTransaction({
      data: executed.calldata,
    });
    expect(executeTransaction.name).to.equal("executeBatch");
    expect([...executeTransaction.args[0]]).to.deep.equal(targetList);
    expect([...executeTransaction.args[1]]).to.deep.equal(valueList);
    expect([...executeTransaction.args[2]]).to.deep.equal(payloadList);
    expect(executeTransaction.args[3]).to.equal(predecessor);
    expect(executeTransaction.args[4]).to.equal(salt);
    await submitAndExecute(
      oldMultisig,
      oldMemberA,
      oldMemberB,
      oldTimelockAddress,
      executed.calldata,
    );

    expect(await oldTimelock.isOperationDone(scheduled.operationId)).to.equal(true);
    expect(await deepFamily.owner()).to.equal(newTimelockAddress);
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);
    expect(await token.balanceOf(oldTimelockAddress)).to.equal(0n);
    expect(await token.balanceOf(newTimelockAddress)).to.equal(scheduledBalance + delayedBalance);

    // Anyone can grief an abandoned address with dust after migration. Confirmation must warn but
    // must not misclassify the already-completed atomic migration as failed.
    await (await token.connect(deployer).transfer(oldTimelockAddress, 1n)).wait();

    const repeated = await withDeployments(deployed, (taskHre) =>
      migrateOwner({ ...commonArgs, phase: "execute" }, taskHre),
    );
    expect(repeated).to.include({
      operationId: scheduled.operationId,
      executed: true,
      alreadyDone: true,
      oldTreasuryBalance: 1n,
    });
  });

  it("migrates successfully when the old timelock DEEP balance is zero", async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily, token } = deployed;
    const [, oldMemberA, oldMemberB, newMemberA, newMemberB] = await hre.ethers.getSigners();
    const oldDelay = 30;
    const { timelock: oldTimelock, multisig: oldMultisig } = await deployTimelockWithMultisig(
      oldDelay,
      oldMemberA,
      oldMemberB,
    );
    const oldTimelockAddress = await oldTimelock.getAddress();
    await (await deepFamily.transferOwnership(oldTimelockAddress)).wait();
    const { timelock: newTimelock, multisig: newMultisig } = await deployTimelockWithMultisig(
      oldDelay,
      newMemberA,
      newMemberB,
    );
    const newTimelockAddress = await newTimelock.getAddress();
    const args = await migrationArgs({
      oldTimelock,
      newTimelock,
      oldMultisig,
      newMultisig,
      phase: "schedule",
    });

    expect(await token.balanceOf(oldTimelockAddress)).to.equal(0n);
    const scheduled = await withDeployments(deployed, (taskHre) => migrateOwner(args, taskHre));
    await submitAndExecute(
      oldMultisig,
      oldMemberA,
      oldMemberB,
      oldTimelockAddress,
      scheduled.calldata,
    );
    await hre.networkHelpers.time.increase(oldDelay + 1);
    const executable = await withDeployments(deployed, (taskHre) =>
      migrateOwner({ ...args, phase: "execute" }, taskHre),
    );
    await submitAndExecute(
      oldMultisig,
      oldMemberA,
      oldMemberB,
      oldTimelockAddress,
      executable.calldata,
    );

    expect(await deepFamily.owner()).to.equal(newTimelockAddress);
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);
    expect(await token.balanceOf(oldTimelockAddress)).to.equal(0n);
    expect(await token.balanceOf(newTimelockAddress)).to.equal(0n);
    const sweepEvents = await oldTimelock.queryFilter(
      oldTimelock.filters.ERC20Swept(await token.getAddress(), newTimelockAddress),
    );
    expect(sweepEvents).to.have.length(1);
    expect(sweepEvents[0].args.amount).to.equal(0n);
  });

  it("rejects a replacement timelock controlled by a single-signer wallet", async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily, token } = deployed;
    const [, oldMemberA, oldMemberB, walletOwner] = await hre.ethers.getSigners();
    const { timelock: oldTimelock, multisig: oldMultisig } = await deployTimelockWithMultisig(
      60,
      oldMemberA,
      oldMemberB,
    );
    const oldTimelockAddress = await oldTimelock.getAddress();
    await (await deepFamily.transferOwnership(oldTimelockAddress)).wait();
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);

    const Wallet = await hre.ethers.getContractFactory("SingleSignerWalletMock");
    const wallet = await Wallet.deploy(await walletOwner.getAddress());
    await wallet.waitForDeployment();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const unsafeTimelock = await Timelock.deploy(60, await wallet.getAddress());
    await unsafeTimelock.waitForDeployment();

    const args = {
      ...artifactArgs,
      phase: "schedule",
      oldTimelock: oldTimelockAddress,
      newTimelock: await unsafeTimelock.getAddress(),
      oldMultisig: await oldMultisig.getAddress(),
      newMultisig: await wallet.getAddress(),
      salt: "",
    };
    const wrongArtifactError = await withDeployments(deployed, (taskHre) =>
      captureError(() =>
        migrateOwner({ ...args, newContractName: "TwoOfTwoMultisigMock" }, taskHre),
      ),
    );
    expect(wrongArtifactError, "expected replacement artifact mismatch rejection").to.be.an(
      "error",
    );
    expect(wrongArtifactError.message).to.match(/new timelock validation failed.*bytecode/i);

    const error = await withDeployments(deployed, (taskHre) =>
      captureError(() => migrateOwner(args, taskHre)),
    );
    expect(error, "expected single-signer replacement rejection").to.be.an("error");
    expect(error.message).to.match(/threshold=1.*at least 2/i);
  });

  it("rejects a replacement with a shorter delay", async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily } = deployed;
    const [, oldMemberA, oldMemberB, newMemberA, newMemberB] = await hre.ethers.getSigners();
    const { timelock: oldTimelock, multisig: oldMultisig } = await deployTimelockWithMultisig(
      120,
      oldMemberA,
      oldMemberB,
    );
    const oldTimelockAddress = await oldTimelock.getAddress();
    await (await deepFamily.transferOwnership(oldTimelockAddress)).wait();

    const { timelock: shorterTimelock, multisig: shorterMultisig } =
      await deployTimelockWithMultisig(60, newMemberA, newMemberB);
    const shorterArgs = await migrationArgs({
      oldTimelock,
      newTimelock: shorterTimelock,
      oldMultisig,
      newMultisig: shorterMultisig,
      phase: "schedule",
    });
    const shorterError = await withDeployments(deployed, (taskHre) =>
      captureError(() => migrateOwner(shorterArgs, taskHre)),
    );
    expect(shorterError, "expected shorter replacement delay rejection").to.be.an("error");
    expect(shorterError.message).to.match(/shorter than current delay/i);
  });

  it("rejects when DeepFamily is owned by neither the old nor new timelock", async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily, token } = deployed;
    const [, oldMemberA, oldMemberB, newMemberA, newMemberB] = await hre.ethers.getSigners();
    const unexpectedOwner = await deepFamily.owner();
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);

    const { timelock: oldTimelock, multisig: oldMultisig } = await deployTimelockWithMultisig(
      120,
      oldMemberA,
      oldMemberB,
    );

    const { timelock: validTimelock, multisig: validMultisig } = await deployTimelockWithMultisig(
      120,
      newMemberA,
      newMemberB,
    );
    expect(unexpectedOwner).to.not.equal(await oldTimelock.getAddress());
    expect(unexpectedOwner).to.not.equal(await validTimelock.getAddress());
    const invalidOwnerArgs = await migrationArgs({
      oldTimelock,
      newTimelock: validTimelock,
      oldMultisig,
      newMultisig: validMultisig,
      phase: "schedule",
    });
    const invalidOwnerError = await withDeployments(deployed, (taskHre) =>
      captureError(() => migrateOwner(invalidOwnerArgs, taskHre)),
    );
    expect(invalidOwnerError, "expected unexpected DeepFamily owner rejection").to.be.an("error");
    expect(invalidOwnerError.message).to.match(/DeepFamily is owned by .*expected old .*or new/i);
  });

  it("rejects an expected new multisig that does not control the replacement timelock", async () => {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const { deepFamily, token } = deployed;
    const [, oldMemberA, oldMemberB, newMemberA, newMemberB, otherA, otherB] =
      await hre.ethers.getSigners();
    const { timelock: oldTimelock, multisig: oldMultisig } = await deployTimelockWithMultisig(
      60,
      oldMemberA,
      oldMemberB,
    );
    const oldTimelockAddress = await oldTimelock.getAddress();
    await (await deepFamily.transferOwnership(oldTimelockAddress)).wait();
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);

    const { timelock: newTimelock } = await deployTimelockWithMultisig(60, newMemberA, newMemberB);
    const unexpectedMultisig = await deployTwoOfTwo(otherA, otherB);
    const args = {
      ...artifactArgs,
      phase: "schedule",
      oldTimelock: oldTimelockAddress,
      newTimelock: await newTimelock.getAddress(),
      oldMultisig: await oldMultisig.getAddress(),
      newMultisig: await unexpectedMultisig.getAddress(),
      salt: "",
    };
    const error = await withDeployments(deployed, (taskHre) =>
      captureError(() => migrateOwner(args, taskHre)),
    );
    expect(error, "expected replacement multisig mismatch rejection").to.be.an("error");
    expect(error.message).to.match(/does not match --new-multisig/i);
  });
});
