import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

const DOMAIN_NAME = "DeepFamily E2E Testnet Multisig";
const DOMAIN_VERSION = "1";
const EXECUTE_TYPES = {
  Execute: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
};

describe("E2ETestnetMultisig", function () {
  const deployMultisig = async () => {
    const [deployer, ownerA, ownerB, ownerC, relayer, outsider, recipient, alternate] =
      await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("E2ETestnetMultisig");
    const multisig = await Multisig.deploy(
      await ownerA.getAddress(),
      await ownerB.getAddress(),
      await ownerC.getAddress(),
    );
    await multisig.waitForDeployment();
    return {
      deployer,
      ownerA,
      ownerB,
      ownerC,
      relayer,
      outsider,
      recipient,
      alternate,
      Multisig,
      multisig,
    };
  };

  const signingDomain = async (multisig, overrides = {}) => {
    const network = await hre.ethers.provider.getNetwork();
    return {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: network.chainId,
      verifyingContract: await multisig.getAddress(),
      ...overrides,
    };
  };

  const signExecution = async (
    signer,
    multisig,
    { target, value = 0n, data = "0x", nonce = undefined, domain = {} },
  ) => {
    const message = {
      target,
      value,
      dataHash: hre.ethers.keccak256(data),
      nonce: nonce ?? (await multisig.nonce()),
    };
    return signer.signTypedData(await signingDomain(multisig, domain), EXECUTE_TYPES, message);
  };

  const signWith = async (multisig, signers, execution) =>
    Promise.all(signers.map((signer) => signExecution(signer, multisig, execution)));

  it("requires three distinct non-zero owners and exposes the 2-of-3 policy", async () => {
    const { ownerA, ownerB, ownerC, outsider, Multisig, multisig } = await deployMultisig();
    const ownerAAddress = await ownerA.getAddress();
    const ownerBAddress = await ownerB.getAddress();
    const ownerCAddress = await ownerC.getAddress();

    await expect(
      Multisig.deploy(hre.ethers.ZeroAddress, ownerBAddress, ownerCAddress),
    ).to.be.revertedWithCustomError(Multisig, "InvalidOwner");
    await expect(
      Multisig.deploy(ownerAAddress, hre.ethers.ZeroAddress, ownerCAddress),
    ).to.be.revertedWithCustomError(Multisig, "InvalidOwner");
    await expect(
      Multisig.deploy(ownerAAddress, ownerBAddress, hre.ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(Multisig, "InvalidOwner");
    await expect(
      Multisig.deploy(ownerAAddress, ownerAAddress, ownerCAddress),
    ).to.be.revertedWithCustomError(Multisig, "DuplicateOwner");
    await expect(
      Multisig.deploy(ownerAAddress, ownerBAddress, ownerAAddress),
    ).to.be.revertedWithCustomError(Multisig, "DuplicateOwner");
    await expect(
      Multisig.deploy(ownerAAddress, ownerBAddress, ownerBAddress),
    ).to.be.revertedWithCustomError(Multisig, "DuplicateOwner");

    expect(await multisig.getOwners()).to.deep.equal([ownerAAddress, ownerBAddress, ownerCAddress]);
    expect(await multisig.getThreshold()).to.equal(2n);
    expect(await multisig.isOwner(ownerAAddress)).to.equal(true);
    expect(await multisig.isOwner(ownerBAddress)).to.equal(true);
    expect(await multisig.isOwner(ownerCAddress)).to.equal(true);
    expect(await multisig.isOwner(await outsider.getAddress())).to.equal(false);
    expect(await multisig.nonce()).to.equal(0n);
  });

  it("accepts every two-owner pair and does not require signature ordering", async () => {
    const { ownerA, ownerB, ownerC, relayer, recipient, multisig } = await deployMultisig();
    const target = await recipient.getAddress();

    for (const signers of [
      [ownerA, ownerB],
      [ownerA, ownerC],
      [ownerB, ownerC],
      [ownerB, ownerA],
    ]) {
      const signatures = await signWith(multisig, signers, { target });
      await multisig.connect(relayer).execute(target, 0, "0x", signatures);
    }

    expect(await multisig.nonce()).to.equal(4n);
  });

  it("lets any relayer execute calldata signed by all owners in any order", async () => {
    const { deployer, ownerA, ownerB, ownerC, relayer, recipient, multisig } =
      await deployMultisig();
    const Token = await hre.ethers.getContractFactory("DeepFamilyToken");
    const token = await Token.connect(deployer).deploy();
    await token.waitForDeployment();
    await (await token.connect(deployer).transferOwnership(await multisig.getAddress())).wait();

    const target = await token.getAddress();
    const recipientAddress = await recipient.getAddress();
    const data = token.interface.encodeFunctionData("transferOwnership", [recipientAddress]);
    const signatures = await signWith(multisig, [ownerC, ownerB, ownerA], { target, data });

    await expect(multisig.connect(relayer).execute(target, 0, data, signatures))
      .to.emit(multisig, "Executed")
      .withArgs(0n, await relayer.getAddress(), target, 0n, hre.ethers.keccak256(data));

    expect(await token.owner()).to.equal(recipientAddress);
    expect(await multisig.nonce()).to.equal(1n);
  });

  it("receives native currency and forwards signed value with CALL", async () => {
    const { deployer, ownerA, ownerB, relayer, recipient, multisig } = await deployMultisig();
    const multisigAddress = await multisig.getAddress();
    const recipientAddress = await recipient.getAddress();
    const amount = hre.ethers.parseEther("0.25");

    await expect(deployer.sendTransaction({ to: multisigAddress, value: amount }))
      .to.emit(multisig, "Received")
      .withArgs(await deployer.getAddress(), amount);

    const signatures = await signWith(multisig, [ownerA, ownerB], {
      target: recipientAddress,
      value: amount,
    });
    const balanceBefore = await hre.ethers.provider.getBalance(recipientAddress);
    await multisig.connect(relayer).execute(recipientAddress, amount, "0x", signatures);

    expect(await hre.ethers.provider.getBalance(recipientAddress)).to.equal(balanceBefore + amount);
    expect(await hre.ethers.provider.getBalance(multisigAddress)).to.equal(0n);
    expect(await multisig.nonce()).to.equal(1n);
  });

  it("drives a real GovernanceTimelock schedule and delayed execution", async () => {
    const { ownerA, ownerB, relayer, multisig } = await deployMultisig();
    const multisigAddress = await multisig.getAddress();
    const minDelay = 60;
    const newDelay = 120;
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(minDelay, multisigAddress);
    await timelock.waitForDeployment();
    const timelockAddress = await timelock.getAddress();

    for (const role of [
      await timelock.PROPOSER_ROLE(),
      await timelock.CANCELLER_ROLE(),
      await timelock.EXECUTOR_ROLE(),
    ]) {
      expect(await timelock.hasRole(role, multisigAddress)).to.equal(true);
    }

    const updateData = timelock.interface.encodeFunctionData("updateDelay", [newDelay]);
    const predecessor = hre.ethers.ZeroHash;
    const salt = hre.ethers.id("e2e-testnet-multisig-update-delay");
    const operationId = await timelock.hashOperation(
      timelockAddress,
      0,
      updateData,
      predecessor,
      salt,
    );
    const scheduleData = timelock.interface.encodeFunctionData("schedule", [
      timelockAddress,
      0,
      updateData,
      predecessor,
      salt,
      minDelay,
    ]);

    // Owners sign offline; the relayer needs no Timelock role of its own.
    const scheduleSignatures = await signWith(multisig, [ownerA, ownerB], {
      target: timelockAddress,
      data: scheduleData,
    });
    await multisig.connect(relayer).execute(timelockAddress, 0, scheduleData, scheduleSignatures);
    expect(await timelock.isOperationPending(operationId)).to.equal(true);
    expect(await multisig.nonce()).to.equal(1n);

    const executeData = timelock.interface.encodeFunctionData("execute", [
      timelockAddress,
      0,
      updateData,
      predecessor,
      salt,
    ]);
    const earlySignatures = await signWith(multisig, [ownerA, ownerB], {
      target: timelockAddress,
      data: executeData,
    });

    await expect(
      multisig.connect(relayer).execute(timelockAddress, 0, executeData, earlySignatures),
    ).to.be.revertedWithCustomError(multisig, "CallFailed");
    expect(await timelock.getMinDelay()).to.equal(BigInt(minDelay));
    expect(await multisig.nonce()).to.equal(1n);

    await hre.networkHelpers.time.increase(minDelay + 1);
    const readySignatures = await signWith(multisig, [ownerA, ownerB], {
      target: timelockAddress,
      data: executeData,
    });
    await expect(
      multisig.connect(relayer).execute(timelockAddress, 0, executeData, readySignatures),
    )
      .to.emit(timelock, "MinDelayChange")
      .withArgs(BigInt(minDelay), BigInt(newDelay));

    expect(await timelock.isOperationDone(operationId)).to.equal(true);
    expect(await timelock.getMinDelay()).to.equal(BigInt(newDelay));
    expect(await multisig.nonce()).to.equal(2n);
  });

  it("rejects invalid counts, duplicate signers, and non-owner signers", async () => {
    const { ownerA, ownerB, ownerC, outsider, recipient, multisig } = await deployMultisig();
    const target = await recipient.getAddress();
    const ownerASignature = await signExecution(ownerA, multisig, { target });
    const ownerBSignature = await signExecution(ownerB, multisig, { target });
    const ownerCSignature = await signExecution(ownerC, multisig, { target });
    const outsiderSignature = await signExecution(outsider, multisig, { target });

    await expect(multisig.execute(target, 0, "0x", [ownerASignature]))
      .to.be.revertedWithCustomError(multisig, "InvalidSignatureCount")
      .withArgs(1n);
    await expect(
      multisig.execute(target, 0, "0x", [
        ownerASignature,
        ownerBSignature,
        ownerCSignature,
        ownerASignature,
      ]),
    )
      .to.be.revertedWithCustomError(multisig, "InvalidSignatureCount")
      .withArgs(4n);
    await expect(multisig.execute(target, 0, "0x", [ownerASignature, ownerASignature]))
      .to.be.revertedWithCustomError(multisig, "DuplicateSigner")
      .withArgs(await ownerA.getAddress());
    await expect(
      multisig.execute(target, 0, "0x", [ownerASignature, ownerBSignature, ownerASignature]),
    )
      .to.be.revertedWithCustomError(multisig, "DuplicateSigner")
      .withArgs(await ownerA.getAddress());
    await expect(multisig.execute(target, 0, "0x", [ownerASignature, outsiderSignature]))
      .to.be.revertedWithCustomError(multisig, "UnauthorizedSigner")
      .withArgs(await outsider.getAddress());
    await expect(
      multisig.execute(target, 0, "0x", [ownerASignature, ownerBSignature, outsiderSignature]),
    )
      .to.be.revertedWithCustomError(multisig, "UnauthorizedSigner")
      .withArgs(await outsider.getAddress());

    expect(await multisig.nonce()).to.equal(0n);
  });

  it("binds signatures to nonce, target, value, and calldata hash", async () => {
    const { ownerA, ownerB, recipient, alternate, multisig } = await deployMultisig();
    const target = await recipient.getAddress();
    const alternateTarget = await alternate.getAddress();
    const data = "0x12345678";
    const signatures = await signWith(multisig, [ownerA, ownerB], {
      target,
      value: 1n,
      data,
    });

    for (const changedExecution of [
      { target: alternateTarget, value: 1n, data },
      { target, value: 2n, data },
      { target, value: 1n, data: "0x12345679" },
    ]) {
      await expect(
        multisig.execute(
          changedExecution.target,
          changedExecution.value,
          changedExecution.data,
          signatures,
        ),
      ).to.be.revertedWithCustomError(multisig, "UnauthorizedSigner");
    }

    const wrongNonceSignatures = await signWith(multisig, [ownerA, ownerB], {
      target,
      nonce: 1n,
    });
    await expect(
      multisig.execute(target, 0, "0x", wrongNonceSignatures),
    ).to.be.revertedWithCustomError(multisig, "UnauthorizedSigner");
    expect(await multisig.nonce()).to.equal(0n);
  });

  it("binds signatures to chain ID and the deployed wallet address", async () => {
    const { ownerA, ownerB, recipient, multisig } = await deployMultisig();
    const target = await recipient.getAddress();
    const network = await hre.ethers.provider.getNetwork();
    const wrongChainSignatures = await signWith(multisig, [ownerA, ownerB], {
      target,
      domain: { chainId: network.chainId + 1n },
    });
    const wrongContractSignatures = await signWith(multisig, [ownerA, ownerB], {
      target,
      domain: { verifyingContract: target },
    });

    await expect(
      multisig.execute(target, 0, "0x", wrongChainSignatures),
    ).to.be.revertedWithCustomError(multisig, "UnauthorizedSigner");
    await expect(
      multisig.execute(target, 0, "0x", wrongContractSignatures),
    ).to.be.revertedWithCustomError(multisig, "UnauthorizedSigner");
    expect(await multisig.nonce()).to.equal(0n);
  });

  it("rejects replay after success", async () => {
    const { ownerA, ownerB, relayer, recipient, multisig } = await deployMultisig();
    const target = await recipient.getAddress();
    const signatures = await signWith(multisig, [ownerA, ownerB], { target });

    await multisig.connect(relayer).execute(target, 0, "0x", signatures);
    await expect(
      multisig.connect(relayer).execute(target, 0, "0x", signatures),
    ).to.be.revertedWithCustomError(multisig, "UnauthorizedSigner");
    expect(await multisig.nonce()).to.equal(1n);
  });

  it("reverts the whole transaction and preserves nonce when the target fails", async () => {
    const { deployer, ownerA, ownerB, relayer, multisig } = await deployMultisig();
    const Token = await hre.ethers.getContractFactory("DeepFamilyToken");
    const token = await Token.connect(deployer).deploy();
    await token.waitForDeployment();
    const multisigAddress = await multisig.getAddress();
    await (await token.connect(deployer).transferOwnership(multisigAddress)).wait();

    const target = await token.getAddress();
    const data = token.interface.encodeFunctionData("transferOwnership", [hre.ethers.ZeroAddress]);
    const signatures = await signWith(multisig, [ownerA, ownerB], { target, data });

    await expect(
      multisig.connect(relayer).execute(target, 0, data, signatures),
    ).to.be.revertedWithCustomError(multisig, "CallFailed");
    expect(await token.owner()).to.equal(multisigAddress);
    expect(await multisig.nonce()).to.equal(0n);
  });

  it("rejects the zero call target", async () => {
    const { multisig } = await deployMultisig();
    await expect(
      multisig.execute(hre.ethers.ZeroAddress, 0, "0x", []),
    ).to.be.revertedWithCustomError(multisig, "InvalidTarget");
  });
});
