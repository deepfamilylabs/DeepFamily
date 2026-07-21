import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import { action as treasuryStatus } from "../tasks/treasury-status.mjs";
import { action as treasuryTransfer } from "../tasks/treasury-transfer.mjs";
import {
  deriveTreasuryTransferSalt,
  parseTreasuryAmount,
  parseTreasuryPhase,
  parseTreasuryRecipient,
} from "../tasks/lib/timelockTreasury.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("timelocked DeepFamily treasury tooling", function () {
  this.timeout(60_000);

  const captureError = async (operation) => {
    try {
      await operation();
      return null;
    } catch (error) {
      return error;
    }
  };

  const baseArgs = (overrides = {}) => ({
    phase: "schedule",
    recipient: "",
    amount: "",
    salt: "",
    contractName: "GovernanceTimelock",
    tokenContractName: "DeepFamilyToken",
    ...overrides,
  });

  const withRecordedDeployments = async ({ deepFamily, token }, callback) => {
    const originalCwd = process.cwd();
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-treasury-task-"));
    const networkName = "treasury-tooling-test";
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
      return await callback(taskHre, deploymentDirectory);
    } finally {
      process.chdir(originalCwd);
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  };

  const deployTreasury = async (minDelay = 60) => {
    const integrated = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [, memberA, memberB, recipient] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await memberA.getAddress(), await memberB.getAddress());
    await multisig.waitForDeployment();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, await multisig.getAddress());
    await timelock.waitForDeployment();
    await (await integrated.deepFamily.transferOwnership(await timelock.getAddress())).wait();

    const deepFamilyAddress = await integrated.deepFamily.getAddress();
    await hre.ethers.provider.send("hardhat_setBalance", [
      deepFamilyAddress,
      "0x56BC75E2D63100000",
    ]);
    await hre.ethers.provider.send("hardhat_impersonateAccount", [deepFamilyAddress]);
    try {
      const deepFamilySigner = await hre.ethers.getSigner(deepFamilyAddress);
      await (
        await integrated.token.connect(deepFamilySigner).mint(await timelock.getAddress())
      ).wait();
    } finally {
      await hre.ethers.provider.send("hardhat_stopImpersonatingAccount", [deepFamilyAddress]);
    }

    return {
      ...integrated,
      multisig,
      timelock,
      memberA,
      memberB,
      recipient,
    };
  };

  const submitAndExecute = async (multisig, memberA, memberB, target, data) => {
    const transactionId = await multisig.transactionCount();
    await (await multisig.connect(memberA).submit(target, 0, data)).wait();
    await (await multisig.connect(memberB).approveAndExecute(transactionId)).wait();
  };

  it("validates phases, recipients, decimal amounts, and deterministic salts", function () {
    expect(parseTreasuryPhase(" SCHEDULE ")).to.equal("schedule");
    expect(parseTreasuryPhase("execute")).to.equal("execute");
    for (const invalid of ["", "stage", undefined]) {
      expect(() => parseTreasuryPhase(invalid)).to.throw(/schedule.*execute/i);
    }

    const recipient = "0x0000000000000000000000000000000000000001";
    expect(parseTreasuryRecipient(hre.ethers, recipient)).to.equal(
      hre.ethers.getAddress(recipient),
    );
    for (const invalid of ["", "not-an-address", hre.ethers.ZeroAddress, undefined]) {
      expect(() => parseTreasuryRecipient(hre.ethers, invalid)).to.throw(/non-zero address/i);
    }

    expect(parseTreasuryAmount(hre.ethers, "1", 18)).to.equal(10n ** 18n);
    expect(parseTreasuryAmount(hre.ethers, "1234.5", 18)).to.equal(12345n * 10n ** 17n);
    expect(parseTreasuryAmount(hre.ethers, "0.000000000000000001", 18)).to.equal(1n);
    for (const invalid of [
      "",
      "0",
      "-1",
      "+1",
      ".5",
      "1e3",
      "01",
      "0.0000000000000000001",
      undefined,
    ]) {
      expect(() => parseTreasuryAmount(hre.ethers, invalid, 18)).to.throw(
        /positive decimal|greater than zero|decimal places/i,
      );
    }

    const values = {
      timelockAddress: "0x0000000000000000000000000000000000000002",
      tokenAddress: "0x0000000000000000000000000000000000000003",
      recipient,
      rawAmount: 123n,
    };
    const salt = deriveTreasuryTransferSalt(hre.ethers, values);
    expect(deriveTreasuryTransferSalt(hre.ethers, values)).to.equal(salt);
    expect(deriveTreasuryTransferSalt(hre.ethers, { ...values, rawAmount: 124n })).not.to.equal(
      salt,
    );
    expect(
      deriveTreasuryTransferSalt(hre.ethers, {
        ...values,
        override: hre.ethers.id("approved-treasury-transfer"),
      }),
    ).to.equal(hre.ethers.id("approved-treasury-transfer"));
    expect(() =>
      deriveTreasuryTransferSalt(hre.ethers, { ...values, override: "0x1234" }),
    ).to.throw(/32-byte/i);
  });

  it("reports the verified timelock's raw and formatted DEEP balance", async () => {
    const deployed = await deployTreasury(3600);
    const timelockAddress = await deployed.timelock.getAddress();
    const expectedBalance = await deployed.token.balanceOf(timelockAddress);

    const report = await withRecordedDeployments(deployed, (taskHre) =>
      treasuryStatus(
        {
          contractName: "GovernanceTimelock",
          tokenContractName: "DeepFamilyToken",
        },
        taskHre,
      ),
    );

    expect(report).to.deep.include({
      deepFamilyAddress: await deployed.deepFamily.getAddress(),
      timelockAddress,
      multisigAddress: await deployed.multisig.getAddress(),
      minDelay: 3600n,
      tokenAddress: await deployed.token.getAddress(),
      symbol: "DEEP",
      decimals: 18,
      rawBalance: expectedBalance,
      formattedBalance: hre.ethers.formatUnits(expectedBalance, 18),
    });
    expect(report.multisigPolicy).to.deep.include({ threshold: 2n });
  });

  it("prints multisig calldata, enforces the delay, and transfers only deployed DEEP", async () => {
    const minDelay = 60;
    const deployed = await deployTreasury(minDelay);
    const timelockAddress = await deployed.timelock.getAddress();
    const tokenAddress = await deployed.token.getAddress();
    const recipientAddress = await deployed.recipient.getAddress();
    const args = baseArgs({ recipient: recipientAddress, amount: "1234.5" });
    const rawAmount = hre.ethers.parseUnits(args.amount, 18);
    const treasuryBefore = await deployed.token.balanceOf(timelockAddress);

    await withRecordedDeployments(deployed, async (taskHre) => {
      const scheduled = await treasuryTransfer(args, taskHre);
      expect(scheduled).to.include({
        phase: "schedule",
        scheduled: false,
        tokenAddress,
        recipient: recipientAddress,
        rawAmount,
      });
      const scheduleCall = deployed.timelock.interface.parseTransaction({
        data: scheduled.calldata,
      });
      expect(scheduleCall.name).to.equal("schedule");
      expect(scheduleCall.args[0]).to.equal(tokenAddress);
      expect(scheduleCall.args[1]).to.equal(0n);
      expect(scheduleCall.args[3]).to.equal(hre.ethers.ZeroHash);
      expect(scheduleCall.args[5]).to.equal(BigInt(minDelay));
      const tokenCall = deployed.token.interface.parseTransaction({ data: scheduleCall.args[2] });
      expect(tokenCall.name).to.equal("transfer");
      expect(tokenCall.args[0]).to.equal(recipientAddress);
      expect(tokenCall.args[1]).to.equal(rawAmount);

      await submitAndExecute(
        deployed.multisig,
        deployed.memberA,
        deployed.memberB,
        timelockAddress,
        scheduled.calldata,
      );
      expect(await deployed.timelock.isOperation(scheduled.operationId)).to.equal(true);

      const tooEarly = await captureError(() =>
        treasuryTransfer({ ...args, phase: "execute" }, taskHre),
      );
      expect(tooEarly, "expected an execution before the delay to abort").to.be.an("error");
      expect(tooEarly.message).to.match(/not ready yet/i);

      const mismatchedAmount = await captureError(() =>
        treasuryTransfer({ ...args, phase: "execute", amount: "1234.6" }, taskHre),
      );
      expect(mismatchedAmount, "expected changed operation parameters to abort").to.be.an("error");
      expect(mismatchedAmount.message).to.match(/not scheduled.*same.*amount/i);

      await hre.networkHelpers.time.increase(minDelay + 1);
      const execution = await treasuryTransfer({ ...args, phase: "execute" }, taskHre);
      expect(execution).to.include({
        phase: "execute",
        executed: false,
        operationId: scheduled.operationId,
      });
      const executeCall = deployed.timelock.interface.parseTransaction({
        data: execution.calldata,
      });
      expect(executeCall.name).to.equal("execute");
      expect(executeCall.args[0]).to.equal(tokenAddress);
      expect(executeCall.args[4]).to.equal(scheduled.salt);

      await submitAndExecute(
        deployed.multisig,
        deployed.memberA,
        deployed.memberB,
        timelockAddress,
        execution.calldata,
      );
      expect(await deployed.timelock.isOperationDone(scheduled.operationId)).to.equal(true);
      expect(await deployed.token.balanceOf(timelockAddress)).to.equal(treasuryBefore - rawAmount);
      expect(await deployed.token.balanceOf(recipientAddress)).to.equal(rawAmount);

      const confirmed = await treasuryTransfer({ ...args, phase: "execute" }, taskHre);
      expect(confirmed).to.include({
        phase: "execute",
        executed: true,
        alreadyDone: true,
        operationId: scheduled.operationId,
      });
    });
  });

  it("rejects insufficient funds and protocol addresses as recipients", async () => {
    const deployed = await deployTreasury();
    const treasuryBalance = await deployed.token.balanceOf(await deployed.timelock.getAddress());
    const recipientAddress = await deployed.recipient.getAddress();
    await withRecordedDeployments(deployed, async (taskHre) => {
      const insufficient = await captureError(() =>
        treasuryTransfer(
          baseArgs({
            recipient: recipientAddress,
            amount: hre.ethers.formatUnits(treasuryBalance + 1n, 18),
          }),
          taskHre,
        ),
      );
      expect(insufficient, "expected insufficient balance to abort").to.be.an("error");
      expect(insufficient.message).to.match(/balance.*below transfer amount/i);

      for (const protectedAddress of [
        await deployed.timelock.getAddress(),
        await deployed.token.getAddress(),
        await deployed.deepFamily.getAddress(),
      ]) {
        const protectedRecipient = await captureError(() =>
          treasuryTransfer(baseArgs({ recipient: protectedAddress, amount: "1" }), taskHre),
        );
        expect(protectedRecipient, "expected protected recipient to abort").to.be.an("error");
        expect(protectedRecipient.message).to.match(/recipient must not be/i);
      }
    });
  });

  it("rejects a deployment record that does not match DeepFamily's token binding", async () => {
    const deployed = await deployTreasury();
    const OtherToken = await hre.ethers.getContractFactory("DeepFamilyToken");
    const otherToken = await OtherToken.deploy();
    await otherToken.waitForDeployment();

    const error = await withRecordedDeployments(
      { deepFamily: deployed.deepFamily, token: otherToken },
      (taskHre) =>
        captureError(() =>
          treasuryStatus(
            {
              contractName: "GovernanceTimelock",
              tokenContractName: "DeepFamilyToken",
            },
            taskHre,
          ),
        ),
    );
    expect(error, "expected mismatched deployment record to abort").to.be.an("error");
    expect(error.message).to.match(/token binding .* does not match deployed DeepFamilyToken/i);
  });
});
