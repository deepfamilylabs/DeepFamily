import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { buildShieldedPoolPublicSignals } from "@deepfamily/protocol-core";

const UINT128_MAX = (1n << 128n) - 1n;
const dataFor = (overrides = {}) => ({
  inputShardIds: [0n, 0n],
  inputRoots: [0n, 0n],
  inputNullifiers: [0n, 0n],
  periodNullifiers: Array(12).fill(0n),
  outputCommitments: [101n, 102n],
  outputCiphertexts: [`0x${"01".repeat(512)}`, `0x${"02".repeat(512)}`],
  relation0: 0n,
  relation1: 0n,
  asOf: 0n,
  fundMode: 0n,
  budgetKind: 0n,
  ...overrides,
});

async function proofFor(pool, action, data, amount = 0n, recipient) {
  const signals = buildShieldedPoolPublicSignals({
    action,
    chainId: (await hre.ethers.provider.getNetwork()).chainId,
    poolAddress: await pool.getAddress(),
    ...data,
    amount,
    recipient,
  });
  return hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "uint256[]"],
    [action + 2, signals],
  );
}

async function setup({ native = false, precision = 18 } = {}) {
  const [depositor, recipient, other] = await hre.ethers.getSigners();
  const token = await hre.ethers.deployContract("ShieldedPoolBehaviorTokenMock", [precision]);
  const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
  const verifier = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
  const poseidon = await hre.ethers.deployContract("PoseidonT3");
  await Promise.all([token, lineage, verifier, poseidon].map((c) => c.waitForDeployment()));
  const libraries = { PoseidonT3: await poseidon.getAddress() };
  const Pool = await hre.ethers.getContractFactory(
    native ? "ShieldedNativePool" : "ShieldedErc20Pool",
    {
      libraries,
    },
  );
  const args = [await lineage.getAddress(), await verifier.getAddress()];
  const pool = await Pool.deploy(...(native ? args : [await token.getAddress(), ...args]));
  await pool.waitForDeployment();
  await token.mint(depositor.address, 1000n);
  await token.approve(await pool.getAddress(), 1000n);
  async function shield(amount = 100n, data = dataFor()) {
    const proof = await proofFor(pool, 0, data, amount);
    return pool.shield(amount, data, proof, native ? { value: amount } : {});
  }
  async function withdrawal(recipientAddress = recipient.address, amount = 30n) {
    const root = (await pool.noteShard(0)).root;
    const data = dataFor({
      inputRoots: [root, root],
      inputNullifiers: [201n, 202n],
      outputCommitments: [103n, 104n],
    });
    const proof = await proofFor(pool, 4, data, amount, recipientAddress);
    return { data, proof, execute: () => pool.unshield(recipientAddress, amount, data, proof) };
  }
  return {
    pool,
    token,
    lineage,
    verifier,
    libraries,
    depositor,
    recipient,
    other,
    shield,
    withdrawal,
  };
}

async function assertUnexecuted(pool, data, liability = 100n) {
  expect(await pool.totalShielded()).to.equal(liability);
  expect((await pool.noteShard(0)).size).to.equal(2n);
  for (const n of data.inputNullifiers) expect(await pool.nullifierSpent(n)).to.equal(false);
  for (const c of data.outputCommitments) expect(await pool.commitmentExists(c)).to.equal(false);
}

describe("immutable multi-asset shielded pool boundaries", function () {
  for (const precision of [6, 18]) {
    it(`escrows and pays exact atomic amounts for a ${precision}-decimal ERC-20`, async function () {
      const { pool, token, recipient, shield, withdrawal } = await setup({ precision });
      expect(await token.decimals()).to.equal(BigInt(precision));
      expect(await pool.assetKind()).to.equal(0n);
      expect(await pool.protocolVersion()).to.equal(1n);
      expect(await pool.creationBlock()).to.equal(
        BigInt((await pool.deploymentTransaction().wait()).blockNumber),
      );
      expect(pool.interface.hasFunction("setCreationBlock")).to.equal(false);
      await shield();
      await (await withdrawal()).execute();
      expect(await token.balanceOf(recipient.address)).to.equal(30n);
      expect(await token.balanceOf(await pool.getAddress())).to.equal(70n);
      expect(await pool.totalShielded()).to.equal(70n);
    });
  }

  for (const [behavior, label] of [
    [1, "recipient fee"],
    [2, "extra sender fee"],
    [3, "sender balance increase"],
    [4, "pool balance decrease"],
  ]) {
    it(`rolls back deposits with ${label}`, async function () {
      const { pool, token, depositor, shield } = await setup();
      const poolAddress = await pool.getAddress();
      await token.mint(poolAddress, 400n);
      await token.setBehavior(behavior, depositor.address, poolAddress);
      await expect(shield()).to.be.revertedWithCustomError(pool, "UnexpectedTokenTransfer");
      expect(await token.balanceOf(depositor.address)).to.equal(1000n);
      expect(await token.balanceOf(poolAddress)).to.equal(400n);
      expect(await pool.totalShielded()).to.equal(0n);
      expect((await pool.noteShard(0)).size).to.equal(0n);
      expect(await pool.commitmentExists(101n)).to.equal(false);
    });
  }

  for (const [behavior, label] of [
    [1, "recipient fee"],
    [2, "extra pool fee"],
    [3, "pool balance increase"],
    [4, "recipient balance decrease"],
  ]) {
    it(`rolls back withdrawals and nullifiers with ${label}`, async function () {
      const { pool, token, recipient, shield, withdrawal } = await setup();
      const poolAddress = await pool.getAddress();
      await shield();
      await token.mint(recipient.address, 100n);
      await token.setBehavior(behavior, poolAddress, recipient.address);
      const attempt = await withdrawal();
      await expect(attempt.execute()).to.be.revertedWithCustomError(
        pool,
        "UnexpectedTokenTransfer",
      );
      await assertUnexecuted(pool, attempt.data);
      expect(await token.balanceOf(poolAddress)).to.equal(100n);
      expect(await token.balanceOf(recipient.address)).to.equal(100n);
    });
  }

  it("enforces uint128 at the contract boundary and accepts its exact maximum", async function () {
    const { pool, token, depositor, shield } = await setup();
    for (const amount of [0n, UINT128_MAX + 1n]) {
      await expect(pool.shield(amount, dataFor(), "0x")).to.be.revertedWithCustomError(
        pool,
        "InvalidAmount",
      );
    }
    await token.mint(depositor.address, UINT128_MAX);
    await token.approve(await pool.getAddress(), UINT128_MAX);
    await shield(UINT128_MAX);
    expect(await pool.totalShielded()).to.equal(UINT128_MAX);
    const attempt = withdrawalInvalidAmount(pool, depositor.address, UINT128_MAX + 1n);
    await expect(attempt).to.be.revertedWithCustomError(pool, "InvalidAmount");
  });

  it("treats direct token transfers as surplus and detects collateral lost after deposit", async function () {
    const { pool, token, shield, withdrawal } = await setup();
    const poolAddress = await pool.getAddress();
    await token.transfer(poolAddress, 50n);
    expect(await pool.totalShielded()).to.equal(0n);
    expect((await pool.noteShard(0)).size).to.equal(0n);
    await shield();
    expect(await token.balanceOf(poolAddress)).to.equal(150n);
    await token.burn(poolAddress, 51n);
    const attempt = await withdrawal();
    await expect(attempt.execute()).to.be.revertedWithCustomError(pool, "InsufficientCollateral");
    await assertUnexecuted(pool, attempt.data);
    expect(await token.balanceOf(poolAddress)).to.equal(99n);
    const extra = dataFor({ outputCommitments: [105n, 106n] });
    await expect(shield(10n, extra)).to.be.revertedWithCustomError(pool, "InsufficientCollateral");
    expect(await token.balanceOf(poolAddress)).to.equal(99n);
  });

  it("blocks a token callback that attempts an otherwise valid private action during payout", async function () {
    const { pool, token, recipient, shield, withdrawal } = await setup();
    await shield();
    const root = (await pool.noteShard(0)).root;
    const nestedData = dataFor({
      inputRoots: [root, root],
      inputNullifiers: [301n, 302n],
      outputCommitments: [105n, 106n],
    });
    const nestedProof = await proofFor(pool, 3, nestedData);
    const nestedCall = pool.interface.encodeFunctionData("privateTransfer", [
      nestedData,
      nestedProof,
    ]);
    const poolAddress = await pool.getAddress();
    await token.setCallback(poolAddress, nestedCall);
    await token.setBehavior(5, poolAddress, recipient.address);
    const attempt = await withdrawal();
    await expect(attempt.execute()).to.be.revertedWithCustomError(token, "TokenCallbackFailed");
    await assertUnexecuted(pool, attempt.data);
    expect(await pool.nullifierSpent(301n)).to.equal(false);
    expect(await pool.commitmentExists(105n)).to.equal(false);
    await token.setBehavior(0, hre.ethers.ZeroAddress, hre.ethers.ZeroAddress);
    await pool.privateTransfer(nestedData, nestedProof);
    expect(await pool.nullifierSpent(301n)).to.equal(true);
  });

  for (const native of [false, true]) {
    it(`rejects zero and self recipients for ${native ? "native" : "ERC-20"} withdrawals`, async function () {
      const { pool, shield } = await setup({ native });
      await shield();
      for (const recipient of [hre.ethers.ZeroAddress, await pool.getAddress()]) {
        await expect(pool.unshield(recipient, 30n, dataFor(), "0x")).to.be.revertedWithCustomError(
          pool,
          "InvalidRecipient",
        );
      }
    });
  }

  it("takes exact native value, rejects unattached payments and never exposes TOKEN", async function () {
    const { pool, depositor, shield, withdrawal } = await setup({ native: true });
    const data = dataFor();
    const proof = await proofFor(pool, 0, data, 100n);
    expect(await pool.assetKind()).to.equal(1n);
    expect(await pool.protocolVersion()).to.equal(1n);
    expect(pool.interface.hasFunction("TOKEN")).to.equal(false);
    for (const value of [0n, 99n, 101n]) {
      await expect(pool.shield(100n, data, proof, { value })).to.be.revertedWithCustomError(
        pool,
        "UnexpectedNativeValue",
      );
    }
    await expect(
      depositor.sendTransaction({ to: await pool.getAddress(), value: 1n }),
    ).to.be.revert(hre.ethers);
    await expect(pool.fund(data, "0x", { value: 1n })).to.revert(hre.ethers);
    await shield();
    const Receiver = await hre.ethers.deployContract("ShieldedNativeReceiverMock");
    await Receiver.waitForDeployment();
    await (await withdrawal(await Receiver.getAddress())).execute();
    expect(await hre.ethers.provider.getBalance(await Receiver.getAddress())).to.equal(30n);
    expect(await hre.ethers.provider.getBalance(await pool.getAddress())).to.equal(70n);
    expect(await pool.totalShielded()).to.equal(70n);
  });

  for (const [mode, label] of [
    [1, "refused payment"],
    [2, "propagated reentrant call"],
  ]) {
    it(`rolls back native withdrawal state on ${label}`, async function () {
      const { pool, shield, withdrawal } = await setup({ native: true });
      await shield();
      const receiver = await hre.ethers.deployContract("ShieldedNativeReceiverMock");
      await receiver.waitForDeployment();
      const attempt = await withdrawal(await receiver.getAddress());
      const nested = pool.interface.encodeFunctionData("unshield", [
        await receiver.getAddress(),
        30n,
        attempt.data,
        attempt.proof,
      ]);
      await receiver.configure(mode, await pool.getAddress(), nested);
      await expect(attempt.execute()).to.be.revertedWithCustomError(pool, "NativeTransferFailed");
      await assertUnexecuted(pool, attempt.data);
      expect(await hre.ethers.provider.getBalance(await pool.getAddress())).to.equal(100n);
      expect(await hre.ethers.provider.getBalance(await receiver.getAddress())).to.equal(0n);
    });
  }

  it("allows a native recipient to immediately forward its payment and preserves forced surplus", async function () {
    const { pool, recipient, shield, withdrawal } = await setup({ native: true });
    const poolAddress = await pool.getAddress();
    const forced = await hre.ethers.deployContract("ShieldedForcedNativeMock", [], { value: 50n });
    await forced.waitForDeployment();
    await forced.force(poolAddress);
    expect(await pool.totalShielded()).to.equal(0n);
    expect((await pool.noteShard(0)).size).to.equal(0n);
    await shield();
    const receiver = await hre.ethers.deployContract("ShieldedNativeReceiverMock");
    await receiver.waitForDeployment();
    await receiver.configure(3, recipient.address, "0x");
    const recipientBefore = await hre.ethers.provider.getBalance(recipient.address);
    await (await withdrawal(await receiver.getAddress())).execute();
    expect(await hre.ethers.provider.getBalance(recipient.address)).to.equal(recipientBefore + 30n);
    expect(await hre.ethers.provider.getBalance(await receiver.getAddress())).to.equal(0n);
    expect(await hre.ethers.provider.getBalance(poolAddress)).to.equal(120n);
    expect(await pool.totalShielded()).to.equal(70n);
  });

  it("uses independent asset liabilities and rejects a proof bound to another pool", async function () {
    const context = await setup();
    const { token, lineage, verifier, libraries, pool } = context;
    const OtherPool = await hre.ethers.getContractFactory("ShieldedErc20Pool", { libraries });
    const other = await OtherPool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await verifier.getAddress(),
    );
    await other.waitForDeployment();
    const data = dataFor();
    const originalProof = await proofFor(pool, 0, data, 100n);
    await expect(other.shield(100n, data, originalProof)).to.be.revertedWithCustomError(
      other,
      "InvalidZKProof",
    );
    await context.shield();
    expect(await pool.totalShielded()).to.equal(100n);
    expect(await other.totalShielded()).to.equal(0n);
    expect(await other.commitmentExists(101n)).to.equal(false);
  });

  it("registers native and DEEP at construction and permissionlessly creates or reuses ERC-20 pools without fees", async function () {
    const {
      token,
      lineage,
      verifier,
      libraries,
      pool: nativePool,
      recipient,
      other,
    } = await setup({ native: true });
    const Factory = await hre.ethers.getContractFactory("ShieldedPoolFactory", { libraries });
    const factory = await Factory.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await verifier.getAddress(),
      await nativePool.getAddress(),
    );
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    const factoryReceipt = await factory.deploymentTransaction().wait();
    const nativeReceipt = await nativePool.deploymentTransaction().wait();
    expect(await nativePool.creationBlock()).to.equal(BigInt(nativeReceipt.blockNumber));
    expect(await nativePool.creationBlock()).to.be.lessThan(BigInt(factoryReceipt.blockNumber));
    expect(await factory.poolFor(hre.ethers.ZeroAddress)).to.equal(await nativePool.getAddress());
    expect(await factory.poolCount()).to.equal(2n);
    const deepPoolAddress = await factory.poolFor(await token.getAddress());
    expect(deepPoolAddress).to.equal(
      hre.ethers.getCreateAddress({ from: factoryAddress, nonce: 1 }),
    );
    const deepPool = await hre.ethers.getContractAt("ShieldedErc20Pool", deepPoolAddress);
    expect(await deepPool.creationBlock()).to.equal(BigInt(factoryReceipt.blockNumber));
    expect(await deepPool.TOKEN()).to.equal(await token.getAddress());
    expect(await deepPool.LINEAGE_INDEX()).to.equal(await lineage.getAddress());
    expect(await deepPool.VERIFIER()).to.equal(await verifier.getAddress());
    expect(await deepPool.assetKind()).to.equal(0n);
    expect(await deepPool.protocolVersion()).to.equal(1n);
    const extra = await hre.ethers.deployContract("ShieldedPoolBehaviorTokenMock", [6]);
    await extra.waitForDeployment();
    const extraAddress = await extra.getAddress();
    const balance = await token.balanceOf(recipient.address);
    expect(await token.allowance(recipient.address, factoryAddress)).to.equal(0n);
    const calls = await Promise.all([
      factory.connect(recipient).createPool(extraAddress),
      factory.connect(other).createPool(extraAddress),
    ]);
    const receipts = await Promise.all(calls.map((tx) => tx.wait()));
    const createdEvents = receipts.flatMap((receipt) =>
      receipt.logs
        .filter((log) => log.address === factoryAddress)
        .map((log) => factory.interface.parseLog(log))
        .filter((event) => event?.name === "PoolCreated"),
    );
    expect(createdEvents).to.have.length(1);
    expect(await factory.poolCount()).to.equal(3n);
    const poolAddress = await factory.poolFor(extraAddress);
    expect(createdEvents[0].args.pool).to.equal(poolAddress);
    expect(await factory.createPool.staticCall(extraAddress)).to.deep.equal([poolAddress, false]);
    await expect(factory.createPool(extraAddress)).not.to.emit(factory, "PoolCreated");
    expect(await factory.poolCount()).to.equal(3n);
    expect(await token.balanceOf(recipient.address)).to.equal(balance);
    expect(await token.balanceOf(factoryAddress)).to.equal(0n);
    const registered = await hre.ethers.getContractAt("ShieldedErc20Pool", poolAddress);
    expect(await registered.TOKEN()).to.equal(extraAddress);
    expect(await registered.LINEAGE_INDEX()).to.equal(await lineage.getAddress());
    expect(await registered.VERIFIER()).to.equal(await verifier.getAddress());
    for (const invalid of [hre.ethers.ZeroAddress, recipient.address]) {
      await expect(factory.createPool(invalid)).to.be.revertedWithCustomError(
        factory,
        "InvalidToken",
      );
    }
    for (const contract of [factory, registered, nativePool]) {
      for (const name of [
        "owner",
        "upgradeToAndCall",
        "pause",
        "sweep",
        "rescue",
        "setVerifier",
        "replacePool",
      ]) {
        expect(contract.interface.hasFunction(name)).to.equal(false);
      }
    }
  });

  it("rejects a predeployed native registration with mismatched asset kind or lineage", async function () {
    const { token, pool, lineage, verifier, libraries } = await setup();
    const Factory = await hre.ethers.getContractFactory("ShieldedPoolFactory", { libraries });
    await expect(
      Factory.deploy(
        await token.getAddress(),
        await lineage.getAddress(),
        await verifier.getAddress(),
        await pool.getAddress(),
      ),
    ).to.be.revertedWithCustomError(Factory, "InvalidNativePool");
    const Native = await hre.ethers.getContractFactory("ShieldedNativePool", { libraries });
    const otherLineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    await otherLineage.waitForDeployment();
    const native = await Native.deploy(
      await otherLineage.getAddress(),
      await verifier.getAddress(),
    );
    await native.waitForDeployment();
    await expect(
      Factory.deploy(
        await token.getAddress(),
        await lineage.getAddress(),
        await verifier.getAddress(),
        await native.getAddress(),
      ),
    ).to.be.revertedWithCustomError(Factory, "InvalidNativePool");
  });
});

function withdrawalInvalidAmount(pool, recipient, amount) {
  return pool.unshield(recipient, amount, dataFor(), "0x");
}
