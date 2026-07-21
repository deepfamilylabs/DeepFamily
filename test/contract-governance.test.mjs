import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";

describe("Timelock + multisig governance", function () {
  this.timeout(60_000);

  it("updates the endorsement fee only after multisig approval and the timelock delay", async () => {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [deployer, member1, member2] = await hre.ethers.getSigners();

    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const multisig = await Multisig.deploy(await member1.getAddress(), await member2.getAddress());
    await multisig.waitForDeployment();
    const multisigAddress = await multisig.getAddress();

    const minDelay = 3600;
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, multisigAddress);
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();

    const exactRoles = [
      [await timelock.DEFAULT_ADMIN_ROLE(), timelockAddress],
      [await timelock.PROPOSER_ROLE(), multisigAddress],
      [await timelock.CANCELLER_ROLE(), multisigAddress],
      [await timelock.EXECUTOR_ROLE(), multisigAddress],
    ];
    for (const [role, expectedMember] of exactRoles) {
      expect(await timelock.getRoleMemberCount(role)).to.equal(1n);
      expect(await timelock.getRoleMember(role, 0)).to.equal(expectedMember);
    }

    await (await deepFamily.transferOwnership(timelockAddress)).wait();
    expect(await deepFamily.owner()).to.equal(timelockAddress);

    const newFee = 750;
    const callData = deepFamily.interface.encodeFunctionData("updateEndorsementFee", [newFee]);
    const salt = hre.ethers.id("update-endorsement-fee-750");
    const scheduleData = timelock.interface.encodeFunctionData("schedule", [
      await deepFamily.getAddress(),
      0,
      callData,
      hre.ethers.ZeroHash,
      salt,
      minDelay,
    ]);

    // The old owner cannot bypass governance after ownership has been handed to the timelock.
    await expect(
      deepFamily.connect(deployer).updateEndorsementFee(newFee),
    ).to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount");

    // One signature only creates the multisig proposal; it does not schedule anything.
    await (await multisig.connect(member1).submit(timelockAddress, 0, scheduleData)).wait();
    expect(await deepFamily.protocolEndorsementFeeBps()).to.equal(500n);

    // The second signature makes the multisig call the timelock as its PROPOSER_ROLE holder.
    await (await multisig.connect(member2).approveAndExecute(0)).wait();

    const executeData = timelock.interface.encodeFunctionData("execute", [
      await deepFamily.getAddress(),
      0,
      callData,
      hre.ethers.ZeroHash,
      salt,
    ]);
    await (await multisig.connect(member1).submit(timelockAddress, 0, executeData)).wait();

    // Even a fully approved multisig execution cannot bypass the configured delay.
    await expect(multisig.connect(member2).approveAndExecute(1)).to.be.revertedWithCustomError(
      multisig,
      "TransactionFailed",
    );
    expect(await deepFamily.protocolEndorsementFeeBps()).to.equal(500n);

    await hre.networkHelpers.time.increase(minDelay + 1);
    await (await multisig.connect(member2).approveAndExecute(1)).wait();

    expect(await deepFamily.protocolEndorsementFeeBps()).to.equal(BigInt(newFee));
    expect(await deepFamily.owner()).to.equal(timelockAddress);

    // A multisig transaction cannot mutate roles immediately; it must schedule a delayed self-call.
    const directGrant = timelock.interface.encodeFunctionData("grantRole", [
      await timelock.PROPOSER_ROLE(),
      await member1.getAddress(),
    ]);
    await (await multisig.connect(member1).submit(timelockAddress, 0, directGrant)).wait();
    await expect(multisig.connect(member2).approveAndExecute(2)).to.be.revertedWithCustomError(
      multisig,
      "TransactionFailed",
    );

    const roleSalt = hre.ethers.id("delayed-role-grant");
    const scheduleRoleGrant = timelock.interface.encodeFunctionData("schedule", [
      timelockAddress,
      0,
      directGrant,
      hre.ethers.ZeroHash,
      roleSalt,
      minDelay,
    ]);
    await (await multisig.connect(member1).submit(timelockAddress, 0, scheduleRoleGrant)).wait();
    await (await multisig.connect(member2).approveAndExecute(3)).wait();

    const executeRoleGrant = timelock.interface.encodeFunctionData("execute", [
      timelockAddress,
      0,
      directGrant,
      hre.ethers.ZeroHash,
      roleSalt,
    ]);
    await (await multisig.connect(member1).submit(timelockAddress, 0, executeRoleGrant)).wait();
    await expect(multisig.connect(member2).approveAndExecute(4)).to.be.revertedWithCustomError(
      multisig,
      "TransactionFailed",
    );
    await hre.networkHelpers.time.increase(minDelay + 1);
    await (await multisig.connect(member2).approveAndExecute(4)).wait();
    expect(
      await timelock.hasRole(await timelock.PROPOSER_ROLE(), await member1.getAddress()),
    ).to.equal(true);
  });

  it("rejects a zero delay or zero governance address at construction", async () => {
    const [owner] = await hre.ethers.getSigners();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");

    await expect(Timelock.deploy(0, await owner.getAddress())).to.be.revertedWithCustomError(
      Timelock,
      "InvalidGovernanceDelay",
    );
    await expect(Timelock.deploy(1, hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Timelock,
      "InvalidGovernanceMultisig",
    );

    const timelock = await Timelock.deploy(1, await owner.getAddress());
    await timelock.waitForDeployment();
    await expect(timelock.updateDelay(0)).to.be.revertedWithCustomError(
      timelock,
      "InvalidGovernanceDelay",
    );
  });

  it("only sweeps ERC20 balances through a delayed self-call with validated inputs", async () => {
    const [governor, recipient] = await hre.ethers.getSigners();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(2, await governor.getAddress());
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();
    const Token = await hre.ethers.getContractFactory("DeepFamilyTokenHarness");
    const token = await Token.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    const recipientAddress = await recipient.getAddress();

    await expect(timelock.sweepERC20(tokenAddress, recipientAddress)).to.be.revertedWithCustomError(
      timelock,
      "TimelockUnauthorizedCaller",
    );

    const scheduleAndAdvance = async (payload, salt) => {
      await timelock.schedule(timelockAddress, 0, payload, hre.ethers.ZeroHash, salt, 2);
      await hre.networkHelpers.time.increase(3);
    };
    const execute = (payload, salt) =>
      timelock.execute(timelockAddress, 0, payload, hre.ethers.ZeroHash, salt);

    const invalidTokenPayload = timelock.interface.encodeFunctionData("sweepERC20", [
      await governor.getAddress(),
      recipientAddress,
    ]);
    const invalidTokenSalt = hre.ethers.id("invalid-treasury-token");
    await scheduleAndAdvance(invalidTokenPayload, invalidTokenSalt);
    await expect(execute(invalidTokenPayload, invalidTokenSalt)).to.be.revertedWithCustomError(
      timelock,
      "InvalidTreasuryToken",
    );

    const invalidRecipientPayload = timelock.interface.encodeFunctionData("sweepERC20", [
      tokenAddress,
      hre.ethers.ZeroAddress,
    ]);
    const invalidRecipientSalt = hre.ethers.id("invalid-treasury-recipient");
    await scheduleAndAdvance(invalidRecipientPayload, invalidRecipientSalt);
    await expect(
      execute(invalidRecipientPayload, invalidRecipientSalt),
    ).to.be.revertedWithCustomError(timelock, "InvalidTreasuryRecipient");

    const amount = hre.ethers.parseEther("12");
    await token.seedSupply(timelockAddress, amount);
    const sweepPayload = timelock.interface.encodeFunctionData("sweepERC20", [
      tokenAddress,
      recipientAddress,
    ]);
    const sweepSalt = hre.ethers.id("valid-treasury-sweep");
    await scheduleAndAdvance(sweepPayload, sweepSalt);
    await expect(execute(sweepPayload, sweepSalt))
      .to.emit(timelock, "ERC20Swept")
      .withArgs(tokenAddress, recipientAddress, amount);
    expect(await token.balanceOf(timelockAddress)).to.equal(0n);
    expect(await token.balanceOf(recipientAddress)).to.equal(amount);
  });
});
