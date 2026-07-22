import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import {
  action as updateTimelockDelay,
  deriveDelayUpdateSalt,
  parseRequiredPositiveInteger,
  parseTimelockPhase,
} from "../tasks/timelock-update-delay.mjs";
import { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE } from "../scripts/lib/governanceSafety.mjs";

describe("timelock-update-delay task", function () {
  this.timeout(60_000);

  const captureError = async (operation) => {
    try {
      await operation();
      return null;
    } catch (error) {
      return error;
    }
  };

  const withRecordedTarget = async (targetAddress, callback, taskEthers = hre.ethers) => {
    const originalCwd = process.cwd();
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-timelock-delay-"));
    const networkName = "timelock-update-delay-test";
    const deploymentDirectory = path.join(temporaryRoot, "deployments", networkName);
    await fs.mkdir(deploymentDirectory, { recursive: true });
    await fs.writeFile(
      path.join(deploymentDirectory, "DeepFamily.json"),
      JSON.stringify({ address: targetAddress }),
    );
    const taskHre = {
      artifacts: hre.artifacts,
      network: {
        connect: async () => ({ ethers: taskEthers, networkName }),
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

  const deployTargetOwnedBy = async (owner) => {
    const Token = await hre.ethers.getContractFactory("DeepFamilyToken");
    const target = await Token.deploy();
    await target.waitForDeployment();
    await (await target.transferOwnership(owner)).wait();
    return target;
  };

  const deploySelfAdminTimelockTarget = async (minDelay = 60) => {
    const [deployer] = await hre.ethers.getSigners();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, await deployer.getAddress());
    await timelock.waitForDeployment();
    const target = await deployTargetOwnedBy(await timelock.getAddress());
    return { target, timelock, deployer };
  };

  const submitAndExecute = async (multisig, memberA, memberB, target, data) => {
    const id = await multisig.transactionCount();
    await (await multisig.connect(memberA).submit(target, 0, data)).wait();
    await (await multisig.connect(memberB).approveAndExecute(id)).wait();
  };

  it("validates the phase, positive delay, and deterministic salt", function () {
    expect(parseTimelockPhase("schedule")).to.equal("schedule");
    expect(parseTimelockPhase(" EXECUTE ")).to.equal("execute");
    for (const invalid of ["", "stage", undefined]) {
      expect(() => parseTimelockPhase(invalid)).to.throw(/schedule.*execute/i);
    }

    expect(parseRequiredPositiveInteger("7200", "new-delay")).to.equal(7200n);
    for (const invalid of ["", "0", "-1", "1.5", "one hour", (1n << 256n).toString(), undefined]) {
      expect(() => parseRequiredPositiveInteger(invalid, "new-delay")).to.throw(
        /positive integer|greater than zero|256-bit/i,
      );
    }

    const timelockAddress = "0x0000000000000000000000000000000000000001";
    const first = deriveDelayUpdateSalt(hre.ethers, { timelockAddress, newDelay: 7200n });
    expect(deriveDelayUpdateSalt(hre.ethers, { timelockAddress, newDelay: 7200n })).to.equal(first);
    expect(deriveDelayUpdateSalt(hre.ethers, { timelockAddress, newDelay: 7201n })).not.to.equal(
      first,
    );
    expect(() =>
      deriveDelayUpdateSalt(hre.ethers, {
        timelockAddress,
        newDelay: 7200n,
        override: "0x1234",
      }),
    ).to.throw(/32-byte/i);
  });

  it("schedules, blocks early execution, executes, and confirms idempotently", async () => {
    const minDelay = 60;
    const newDelay = "120";
    const { target, timelock } = await deploySelfAdminTimelockTarget(minDelay);
    const args = { phase: "schedule", newDelay, salt: "" };

    await withRecordedTarget(await target.getAddress(), async (taskHre) => {
      const scheduled = await updateTimelockDelay(args, taskHre);
      expect(scheduled).to.include({ phase: "schedule", scheduled: true });
      expect(await timelock.isOperation(scheduled.operationId)).to.equal(true);

      const tooEarly = await captureError(() =>
        updateTimelockDelay({ ...args, phase: "execute" }, taskHre),
      );
      expect(tooEarly, "expected execution before the delay to abort").to.be.an("error");
      expect(tooEarly.message).to.match(/not ready yet/i);

      await hre.networkHelpers.time.increase(minDelay + 1);
      const executed = await updateTimelockDelay({ ...args, phase: "execute" }, taskHre);
      expect(executed).to.include({ phase: "execute", executed: true });
      expect(executed.alreadyDone).to.equal(undefined);
      expect(await timelock.getMinDelay()).to.equal(120n);

      const repeated = await updateTimelockDelay({ ...args, phase: "execute" }, taskHre);
      expect(repeated).to.include({
        phase: "execute",
        executed: true,
        alreadyDone: true,
        operationId: executed.operationId,
      });
    });
  });

  it("prints calldata without a local signer and executes both phases through a 2-of-2 multisig", async () => {
    const [, memberA, memberB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await memberA.getAddress(), await memberB.getAddress());
    await multisig.waitForDeployment();

    const minDelay = 60;
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, await multisig.getAddress());
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();
    const target = await deployTargetOwnedBy(timelockAddress);

    const ethersWithoutSigner = new Proxy(hre.ethers, {
      get(targetObject, property, receiver) {
        if (property === "getSigners") return async () => [];
        return Reflect.get(targetObject, property, receiver);
      },
    });
    const baseArgs = { newDelay: "120", salt: "" };

    await withRecordedTarget(
      await target.getAddress(),
      async (taskHre) => {
        const scheduled = await updateTimelockDelay({ ...baseArgs, phase: "schedule" }, taskHre);
        expect(scheduled).to.include({ phase: "schedule", scheduled: false });
        expect(scheduled.calldata).to.match(/^0x[0-9a-f]+$/i);
        const scheduleCall = timelock.interface.parseTransaction({ data: scheduled.calldata });
        expect(scheduleCall.name).to.equal("schedule");
        expect(scheduleCall.args[0]).to.equal(timelockAddress);
        expect(scheduleCall.args[1]).to.equal(0n);
        expect(scheduleCall.args[3]).to.equal(hre.ethers.ZeroHash);
        expect(scheduleCall.args[5]).to.equal(BigInt(minDelay));

        await submitAndExecute(multisig, memberA, memberB, timelockAddress, scheduled.calldata);
        expect(await timelock.isOperation(scheduled.operationId)).to.equal(true);

        await hre.networkHelpers.time.increase(minDelay + 1);
        const executed = await updateTimelockDelay({ ...baseArgs, phase: "execute" }, taskHre);
        expect(executed).to.include({ phase: "execute", executed: false });
        expect(executed.calldata).to.match(/^0x[0-9a-f]+$/i);
        const executeCall = timelock.interface.parseTransaction({ data: executed.calldata });
        expect(executeCall.name).to.equal("execute");

        await submitAndExecute(multisig, memberA, memberB, timelockAddress, executed.calldata);
        expect(await timelock.isOperationDone(scheduled.operationId)).to.equal(true);
        expect(await timelock.getMinDelay()).to.equal(120n);
      },
      ethersWithoutSigner,
    );
  });

  it("rejects scheduling the current delay as a no-op", async () => {
    const { target } = await deploySelfAdminTimelockTarget(60);
    const error = await withRecordedTarget(await target.getAddress(), (taskHre) =>
      captureError(() =>
        updateTimelockDelay({ phase: "schedule", newDelay: "60", salt: "" }, taskHre),
      ),
    );

    expect(error, "expected same-delay scheduling to abort").to.be.an("error");
    expect(error.message).to.match(/equals the current delay/i);
  });

  it("enforces the configured governance wallet profile before preparing a delay update", async () => {
    const { target } = await deploySelfAdminTimelockTarget(60);
    const originalProfile = process.env.GOVERNANCE_MULTISIG_PROFILE;
    process.env.GOVERNANCE_MULTISIG_PROFILE = CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE;
    try {
      const error = await withRecordedTarget(await target.getAddress(), (taskHre) =>
        captureError(() =>
          updateTimelockDelay({ phase: "schedule", newDelay: "120", salt: "" }, taskHre),
        ),
      );
      expect(error, "expected the strict wallet profile to abort").to.be.an("error");
      expect(error.message).to.match(/current governance multisig .* has no contract code/i);
    } finally {
      if (originalProfile === undefined) delete process.env.GOVERNANCE_MULTISIG_PROFILE;
      else process.env.GOVERNANCE_MULTISIG_PROFILE = originalProfile;
    }
  });

  it("rejects an interface-compatible-looking owner with the wrong runtime", async () => {
    const [, ownerA, ownerB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const wrongRuntime = await Multisig.deploy(
      await ownerA.getAddress(),
      await ownerB.getAddress(),
    );
    await wrongRuntime.waitForDeployment();
    const target = await deployTargetOwnedBy(await wrongRuntime.getAddress());

    const error = await withRecordedTarget(await target.getAddress(), (taskHre) =>
      captureError(() =>
        updateTimelockDelay({ phase: "schedule", newDelay: "7200", salt: "" }, taskHre),
      ),
    );

    expect(error, "expected wrong timelock runtime to abort").to.be.an("error");
    expect(error.message).to.match(/bytecode does NOT match artifact GovernanceTimelock/i);
  });

  it("rejects a genuine timelock that is no longer exclusively self-administered", async () => {
    const [, outsider] = await hre.ethers.getSigners();
    const minDelay = 2;
    const { target, timelock, deployer } = await deploySelfAdminTimelockTarget(minDelay);
    const timelockAddress = await timelock.getAddress();
    const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
    const payload = timelock.interface.encodeFunctionData("grantRole", [
      adminRole,
      await outsider.getAddress(),
    ]);
    const salt = hre.ethers.id("make-timelock-admin-membership-unsafe");
    await (
      await timelock
        .connect(deployer)
        .schedule(timelockAddress, 0, payload, hre.ethers.ZeroHash, salt, minDelay)
    ).wait();
    await hre.networkHelpers.time.increase(minDelay + 1);
    await (
      await timelock
        .connect(deployer)
        .execute(timelockAddress, 0, payload, hre.ethers.ZeroHash, salt)
    ).wait();
    expect(await timelock.getRoleMemberCount(adminRole)).to.equal(2n);

    const error = await withRecordedTarget(await target.getAddress(), (taskHre) =>
      captureError(() =>
        updateTimelockDelay({ phase: "schedule", newDelay: "120", salt: "" }, taskHre),
      ),
    );

    expect(error, "expected non-exclusive self-admin timelock to abort").to.be.an("error");
    expect(error.message).to.match(/not self-administered exclusively/i);
  });
});
