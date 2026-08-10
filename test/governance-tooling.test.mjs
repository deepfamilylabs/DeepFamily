import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import { action as cancelGovernance } from "../tasks/governance-cancel.mjs";
import { action as executeGovernance } from "../tasks/governance-execute.mjs";
import { action as scheduleGovernance } from "../tasks/governance-schedule.mjs";
import {
  deriveGovernanceSalt,
  parseGovernanceArgs,
  parseGovernanceDelay,
  resolveGovernanceCall,
  simulateGovernanceCall,
} from "../tasks/lib/timelockGovernance.mjs";
import { resolveGovernedTarget } from "../tasks/lib/timelockUpgrade.mjs";
import { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE } from "../scripts/lib/governanceSafety.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("Generic governance tooling", function () {
  this.timeout(60_000);

  const mainContract = async () => {
    const artifact = await hre.artifacts.readArtifact("DeepFamily");
    return { interface: new hre.ethers.Interface(artifact.abi) };
  };

  describe("ABI call parsing", function () {
    it("encodes a known function by name or full signature", async () => {
      const targetContract = await mainContract();
      const byName = resolveGovernanceCall({
        ethers: hre.ethers,
        targetContract,
        functionName: "updateEndorsementFee",
        rawArgs: "[750]",
      });
      const bySignature = resolveGovernanceCall({
        ethers: hre.ethers,
        targetContract,
        functionName: "updateEndorsementFee(uint256)",
        rawArgs: '["750"]',
      });

      expect(byName.signature).to.equal("updateEndorsementFee(uint256)");
      expect(byName.calldata).to.equal(bySignature.calldata);
      expect(
        targetContract.interface.decodeFunctionData("updateEndorsementFee", byName.calldata)[0],
      ).to.equal(750n);
    });

    it("rejects invalid JSON, non-array args, and unsafe JSON numbers", function () {
      expect(() => parseGovernanceArgs("not-json")).to.throw(/valid JSON/i);
      expect(() => parseGovernanceArgs('{"fee":750}')).to.throw(/JSON array/i);
      expect(() => parseGovernanceArgs("[9007199254740992]")).to.throw(
        /quote integer values as strings/i,
      );
      expect(() => parseGovernanceArgs("[1.5]")).to.throw(/non-integer/i);
      expect(parseGovernanceArgs('["9007199254740992"]')).to.deep.equal(["9007199254740992"]);
    });

    it("rejects unknown ABI functions", async () => {
      const targetContract = await mainContract();
      expect(() =>
        resolveGovernanceCall({
          ethers: hre.ethers,
          targetContract,
          functionName: "setAnything",
          rawArgs: "[]",
        }),
      ).to.throw(/Cannot resolve --function/i);
    });

    it("blocks upgrades and ownership changes from the generic path", async () => {
      const targetContract = await mainContract();
      const blocked = [
        ["upgradeToAndCall", `["${hre.ethers.ZeroAddress}","0x"]`, /upgrade-schedule/i],
        [
          "upgradeToAndCall(address,bytes)",
          `["${hre.ethers.ZeroAddress}","0x"]`,
          /upgrade-schedule/i,
        ],
        ["transferOwnership", `["${hre.ethers.ZeroAddress}"]`, /governance migration/i],
        ["renounceOwnership", "[]", /final governance exit/i],
      ];

      for (const [functionName, rawArgs, reason] of blocked) {
        expect(() =>
          resolveGovernanceCall({
            ethers: hre.ethers,
            targetContract,
            functionName,
            rawArgs,
          }),
        ).to.throw(reason);
      }

      // OpenZeppelin 5's UUPS ABI currently exposes upgradeToAndCall only. Keep the legacy
      // upgradeTo selector covered as well so a future ABI change cannot reopen the generic path.
      const legacyUpgradeTarget = {
        interface: new hre.ethers.Interface(["function upgradeTo(address)"]),
      };
      expect(() =>
        resolveGovernanceCall({
          ethers: hre.ethers,
          targetContract: legacyUpgradeTarget,
          functionName: "upgradeTo",
          rawArgs: `["${hre.ethers.ZeroAddress}"]`,
        }),
      ).to.throw(/upgrade-schedule/i);
    });
  });

  describe("operation parameters", function () {
    it("derives a deterministic, call-bound salt and validates overrides", async () => {
      const targetContract = await mainContract();
      const address = "0x0000000000000000000000000000000000000001";
      const calldata750 = targetContract.interface.encodeFunctionData(
        "updateEndorsementFee",
        [750],
      );
      const calldata800 = targetContract.interface.encodeFunctionData(
        "updateEndorsementFee",
        [800],
      );

      const first = deriveGovernanceSalt(hre.ethers, {
        targetAddress: address,
        calldata: calldata750,
      });
      const same = deriveGovernanceSalt(hre.ethers, {
        targetAddress: address,
        calldata: calldata750,
      });
      const differentCall = deriveGovernanceSalt(hre.ethers, {
        targetAddress: address,
        calldata: calldata800,
      });
      const differentTarget = deriveGovernanceSalt(hre.ethers, {
        targetAddress: "0x0000000000000000000000000000000000000002",
        calldata: calldata750,
      });

      expect(first).to.equal(same);
      expect(first).not.to.equal(differentCall);
      expect(first).not.to.equal(differentTarget);

      const override = hre.ethers.id("reviewed-governance-operation");
      expect(
        deriveGovernanceSalt(hre.ethers, {
          targetAddress: address,
          calldata: calldata750,
          override,
        }),
      ).to.equal(override);
      expect(() =>
        deriveGovernanceSalt(hre.ethers, {
          targetAddress: address,
          calldata: calldata750,
          override: "0x1234",
        }),
      ).to.throw(/32-byte/i);
    });

    it("defaults to minDelay and rejects shorter or invalid delays", function () {
      expect(parseGovernanceDelay("", 3600n)).to.equal(3600n);
      expect(parseGovernanceDelay("7200", 3600n)).to.equal(7200n);
      expect(() => parseGovernanceDelay("3599", 3600n)).to.throw(/below.*minDelay/i);
      expect(() => parseGovernanceDelay("-1", 3600n)).to.throw(/non-negative/i);
      expect(() => parseGovernanceDelay("one hour", 3600n)).to.throw(/integer/i);
    });
  });

  describe("schedule / execute task guards", function () {
    it("shares the optional strict wallet-profile gate while preserving the blank-profile path", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [, ownerA, ownerB] = await hre.ethers.getSigners();
      const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
      const multisig = await Multisig.deploy(await ownerA.getAddress(), await ownerB.getAddress());
      await multisig.waitForDeployment();
      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const timelock = await Timelock.deploy(60, await multisig.getAddress());
      await timelock.waitForDeployment();
      await (await deepFamily.transferOwnership(await timelock.getAddress())).wait();

      const originalCwd = process.cwd();
      const originalProfile = process.env.GOVERNANCE_SAFE_PROFILE;
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-profile-gate-"));
      const networkName = "governance-profile-gate";
      const deploymentDirectory = path.join(temporaryRoot, "deployments", networkName);
      await fs.mkdir(deploymentDirectory, { recursive: true });
      await fs.writeFile(
        path.join(deploymentDirectory, "DeepFamily.json"),
        JSON.stringify({ address: await deepFamily.getAddress() }),
      );
      const connection = { ethers: hre.ethers, networkName };

      try {
        process.chdir(temporaryRoot);
        delete process.env.GOVERNANCE_SAFE_PROFILE;
        const generic = await resolveGovernedTarget(connection, hre.ethers, "main");
        expect(generic.governanceProfile).to.equal(null);

        process.env.GOVERNANCE_SAFE_PROFILE = CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE;
        await expect(resolveGovernedTarget(connection, hre.ethers, "main")).to.be.rejectedWith(
          /restricted to Conflux eSpace.*31337/i,
        );
      } finally {
        process.chdir(originalCwd);
        if (originalProfile === undefined) delete process.env.GOVERNANCE_SAFE_PROFILE;
        else process.env.GOVERNANCE_SAFE_PROFILE = originalProfile;
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
    });

    it("enforces scheduling state and the timelock delay before executing", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [deployer] = await hre.ethers.getSigners();
      const minDelay = 60;
      const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
      const timelock = await Timelock.deploy(minDelay, await deployer.getAddress());
      await timelock.waitForDeployment();
      await (await deepFamily.transferOwnership(await timelock.getAddress())).wait();

      const originalCwd = process.cwd();
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-governance-task-"));
      const networkName = "governance-tooling";
      const deploymentDirectory = path.join(temporaryRoot, "deployments", networkName);
      await fs.mkdir(deploymentDirectory, { recursive: true });
      await fs.writeFile(
        path.join(deploymentDirectory, "DeepFamily.json"),
        JSON.stringify({ address: await deepFamily.getAddress() }),
      );

      const taskHre = {
        network: {
          connect: async () => ({ ethers: hre.ethers, networkName }),
        },
      };
      const scheduledCall = {
        target: "main",
        function: "updateEndorsementFee",
        args: "[750]",
        delay: "",
        salt: "",
        skipSimulation: false,
      };

      const captureError = async (operation) => {
        try {
          await operation();
        } catch (error) {
          return error;
        }
        return undefined;
      };

      process.chdir(temporaryRoot);
      try {
        const unscheduled = await captureError(() =>
          executeGovernance({ ...scheduledCall, args: "[751]" }, taskHre),
        );
        expect(unscheduled, "expected an unscheduled operation abort").to.be.an("error");
        expect(unscheduled.message).to.match(/operation is not scheduled/i);

        const scheduled = await scheduleGovernance(scheduledCall, taskHre);
        expect(scheduled.scheduled).to.equal(true);

        const duplicate = await captureError(() => scheduleGovernance(scheduledCall, taskHre));
        expect(duplicate, "expected a duplicate schedule abort").to.be.an("error");
        expect(duplicate.message).to.match(/already scheduled or executed/i);

        const tooEarly = await captureError(() => executeGovernance(scheduledCall, taskHre));
        expect(tooEarly, "expected a not-ready operation abort").to.be.an("error");
        expect(tooEarly.message).to.match(/not ready yet/i);

        const cancelled = await cancelGovernance(
          { target: "main", operationId: scheduled.operationId },
          taskHre,
        );
        expect(cancelled).to.include({ cancelled: true });
        expect(await timelock.isOperation(scheduled.operationId)).to.equal(false);

        const rescheduled = await scheduleGovernance(scheduledCall, taskHre);
        expect(rescheduled).to.include({ scheduled: true, operationId: scheduled.operationId });

        await hre.networkHelpers.time.increase(minDelay + 1);
        const executed = await executeGovernance(scheduledCall, taskHre);
        expect(executed).to.include({ executed: true });
        expect(await deepFamily.protocolEndorsementFeeBps()).to.equal(750n);

        const repeated = await executeGovernance(scheduledCall, taskHre);
        expect(repeated).to.include({ executed: true, alreadyDone: true });
      } finally {
        process.chdir(originalCwd);
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
    });
  });

  it("simulates calls as the timelock and rejects a fee above the contract maximum", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [deployer] = await hre.ethers.getSigners();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(3600, await deployer.getAddress());
    await timelock.waitForDeployment();
    await (await deepFamily.transferOwnership(await timelock.getAddress())).wait();

    const base = {
      ethers: hre.ethers,
      targetAddress: await deepFamily.getAddress(),
      timelockAddress: await timelock.getAddress(),
    };
    await simulateGovernanceCall({
      ...base,
      calldata: deepFamily.interface.encodeFunctionData("updateEndorsementFee", [750]),
    });

    const maximum = await deepFamily.PROTOCOL_FEE_BPS_MAX();
    let err;
    try {
      await simulateGovernanceCall({
        ...base,
        calldata: deepFamily.interface.encodeFunctionData("updateEndorsementFee", [maximum + 1n]),
      });
    } catch (error) {
      err = error;
    }
    expect(err, "expected the pre-flight simulation to abort").to.be.an("error");
    expect(err.message).to.match(/simulation reverted/i);
  });
});
