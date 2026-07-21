import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import { action as migrateMultisig } from "../tasks/timelock-migrate-multisig.mjs";
import {
  parseMultisigMigrationPhase,
  readExactTimelockRoleState,
} from "../tasks/lib/timelockMultisigMigration.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("timelock-migrate-multisig task", function () {
  this.timeout(60_000);

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

  const submitAndExecute = async (multisig, memberA, memberB, target, data) => {
    const id = await multisig.transactionCount();
    await (await multisig.connect(memberA).submit(target, 0, data)).wait();
    await (await multisig.connect(memberB).approveAndExecute(id)).wait();
  };

  const withTaskDeployment = async (deepFamily, operation) => {
    const originalCwd = process.cwd();
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "deepfamily-multisig-migration-"),
    );
    const networkName = "multisig-migration-tooling";
    const deploymentDirectory = path.join(temporaryRoot, "deployments", networkName);
    await fs.mkdir(deploymentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(deploymentDirectory, "DeepFamily.json"),
      JSON.stringify({ address: await deepFamily.getAddress() }),
    );

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

    process.chdir(temporaryRoot);
    try {
      return await operation(taskHre);
    } finally {
      process.chdir(originalCwd);
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  };

  it("atomically grants the new multisig three roles and revokes the old multisig", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, oldMemberA, oldMemberB, newMemberA, newMemberB] = await hre.ethers.getSigners();
    const oldMultisig = await deployTwoOfTwo(oldMemberA, oldMemberB);
    const newMultisig = await deployTwoOfTwo(newMemberA, newMemberB);
    const oldMultisigAddress = await oldMultisig.getAddress();
    const newMultisigAddress = await newMultisig.getAddress();

    const minDelay = 60;
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, oldMultisigAddress);
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();
    await (await deepFamily.transferOwnership(timelockAddress)).wait();

    const baseArgs = {
      target: "main",
      oldMultisig: oldMultisigAddress,
      newMultisig: newMultisigAddress,
      delay: "",
      salt: "",
    };

    const {
      scheduled,
      operationId,
      salt,
      calldata: scheduleCalldata,
    } = await withTaskDeployment(deepFamily, (taskHre) =>
      migrateMultisig({ ...baseArgs, phase: "schedule" }, taskHre),
    );
    expect(scheduled).to.equal(false);
    expect(scheduleCalldata).to.match(/^0x[0-9a-f]+$/i);

    const scheduleTransaction = timelock.interface.parseTransaction({ data: scheduleCalldata });
    expect(scheduleTransaction.name).to.equal("scheduleBatch");
    const [targets, values, payloads, predecessor, encodedSalt, delay] = scheduleTransaction.args;
    expect(targets).to.have.length(6);
    expect(new Set(targets.map((target) => target.toLowerCase()))).to.deep.equal(
      new Set([timelockAddress.toLowerCase()]),
    );
    expect(values.every((value) => value === 0n)).to.equal(true);
    expect(payloads).to.have.length(6);
    expect(predecessor).to.equal(hre.ethers.ZeroHash);
    expect(encodedSalt).to.equal(salt);
    expect(delay).to.equal(BigInt(minDelay));

    const proposerRole = await timelock.PROPOSER_ROLE();
    const cancellerRole = await timelock.CANCELLER_ROLE();
    const executorRole = await timelock.EXECUTOR_ROLE();
    const expectedRoles = [proposerRole, cancellerRole, executorRole];
    for (let index = 0; index < 3; index += 1) {
      const grant = timelock.interface.parseTransaction({ data: payloads[index] });
      const revoke = timelock.interface.parseTransaction({ data: payloads[index + 3] });
      expect(grant.name).to.equal("grantRole");
      expect(grant.args[0]).to.equal(expectedRoles[index]);
      expect(grant.args[1]).to.equal(newMultisigAddress);
      expect(revoke.name).to.equal("revokeRole");
      expect(revoke.args[0]).to.equal(expectedRoles[index]);
      expect(revoke.args[1]).to.equal(oldMultisigAddress);
    }

    await submitAndExecute(oldMultisig, oldMemberA, oldMemberB, timelockAddress, scheduleCalldata);
    expect(await timelock.isOperation(operationId)).to.equal(true);

    const tooEarly = await withTaskDeployment(deepFamily, (taskHre) =>
      captureError(() => migrateMultisig({ ...baseArgs, phase: "execute" }, taskHre)),
    );
    expect(tooEarly, "expected the delay guard to abort").to.be.an("error");
    expect(tooEarly.message).to.match(/not ready/i);

    await hre.networkHelpers.time.increase(minDelay + 1);
    const executeResult = await withTaskDeployment(deepFamily, (taskHre) =>
      migrateMultisig({ ...baseArgs, phase: "execute" }, taskHre),
    );
    expect(executeResult.executed).to.equal(false);
    expect(executeResult.calldata).to.match(/^0x[0-9a-f]+$/i);
    await submitAndExecute(
      oldMultisig,
      oldMemberA,
      oldMemberB,
      timelockAddress,
      executeResult.calldata,
    );

    expect(await timelock.isOperationDone(operationId)).to.equal(true);
    for (const role of expectedRoles) {
      expect(await timelock.getRoleMemberCount(role)).to.equal(1n);
      expect(await timelock.getRoleMember(role, 0)).to.equal(newMultisigAddress);
      expect(await timelock.hasRole(role, oldMultisigAddress)).to.equal(false);
    }
    expect(await timelock.getRoleMemberCount(await timelock.DEFAULT_ADMIN_ROLE())).to.equal(1n);
    expect(await timelock.getRoleMember(await timelock.DEFAULT_ADMIN_ROLE(), 0)).to.equal(
      timelockAddress,
    );

    const repeated = await withTaskDeployment(deepFamily, (taskHre) =>
      migrateMultisig({ ...baseArgs, phase: "execute" }, taskHre),
    );
    expect(repeated).to.include({ executed: true, alreadyDone: true, operationId });
  });

  it("rejects invalid phases, identical multisigs, codeless wallets, and threshold 1", async () => {
    for (const invalid of ["", "now", undefined]) {
      expect(() => parseMultisigMigrationPhase(invalid)).to.throw(/schedule.*execute/i);
    }

    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [deployer, oldMemberA, oldMemberB, newMemberA] = await hre.ethers.getSigners();
    const oldMultisig = await deployTwoOfTwo(oldMemberA, oldMemberB);
    const oldMultisigAddress = await oldMultisig.getAddress();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(60, oldMultisigAddress);
    await timelock.waitForDeployment();
    await (await deepFamily.transferOwnership(await timelock.getAddress())).wait();

    const args = {
      phase: "schedule",
      target: "main",
      oldMultisig: oldMultisigAddress,
      newMultisig: oldMultisigAddress,
      delay: "",
      salt: "",
    };
    const identical = await withTaskDeployment(deepFamily, (taskHre) =>
      captureError(() => migrateMultisig(args, taskHre)),
    );
    expect(identical.message).to.match(/must be different/i);

    const deployerAddress = await deployer.getAddress();
    const codeless = await withTaskDeployment(deepFamily, (taskHre) =>
      captureError(() => migrateMultisig({ ...args, newMultisig: deployerAddress }, taskHre)),
    );
    expect(codeless.message).to.match(/has no contract code/i);

    const SingleSigner = await hre.ethers.getContractFactory("SingleSignerWalletMock");
    const singleSigner = await SingleSigner.deploy(await newMemberA.getAddress());
    await singleSigner.waitForDeployment();
    const singleSignerAddress = await singleSigner.getAddress();
    const thresholdOne = await withTaskDeployment(deepFamily, (taskHre) =>
      captureError(() => migrateMultisig({ ...args, newMultisig: singleSignerAddress }, taskHre)),
    );
    expect(thresholdOne.message).to.match(/threshold=1.*at least 2/i);
  });

  it("rejects extra role members and a non-self Timelock admin", async () => {
    const [timelockAddress, multisigA, multisigB] = [
      "0x0000000000000000000000000000000000000011",
      "0x0000000000000000000000000000000000000022",
      "0x0000000000000000000000000000000000000033",
    ];
    const roleIds = {
      DEFAULT_ADMIN_ROLE: hre.ethers.ZeroHash,
      PROPOSER_ROLE: hre.ethers.id("PROPOSER_ROLE"),
      CANCELLER_ROLE: hre.ethers.id("CANCELLER_ROLE"),
      EXECUTOR_ROLE: hre.ethers.id("EXECUTOR_ROLE"),
    };
    const members = new Map([
      [roleIds.DEFAULT_ADMIN_ROLE, [timelockAddress]],
      [roleIds.PROPOSER_ROLE, [multisigA, multisigB]],
      [roleIds.CANCELLER_ROLE, [multisigA]],
      [roleIds.EXECUTOR_ROLE, [multisigA]],
    ]);
    const fakeTimelock = {
      ...Object.fromEntries(
        Object.entries(roleIds).map(([name, role]) => [name, async () => role]),
      ),
      getRoleMemberCount: async (role) => BigInt(members.get(role).length),
      getRoleMember: async (role, index) => members.get(role)[index],
    };

    const extraMember = await captureError(() =>
      readExactTimelockRoleState({
        ethers: hre.ethers,
        timelock: fakeTimelock,
        timelockAddress,
      }),
    );
    expect(extraMember.message).to.match(/PROPOSER_ROLE.*exactly 1.*found 2/i);

    members.set(roleIds.PROPOSER_ROLE, [multisigA]);
    members.set(roleIds.DEFAULT_ADMIN_ROLE, [multisigB]);
    const wrongAdmin = await captureError(() =>
      readExactTimelockRoleState({
        ethers: hre.ethers,
        timelock: fakeTimelock,
        timelockAddress,
      }),
    );
    expect(wrongAdmin.message).to.match(/DEFAULT_ADMIN_ROLE.*not the timelock itself/i);
  });
});
