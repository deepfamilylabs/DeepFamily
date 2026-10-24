import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import {
  buildShieldedPoolPublicSignals,
  emptyShieldedReceiveAuthorizations,
} from "@deepfamily/protocol-core";
import {
  authorizeMockReceive,
  deployMockReceiveAuthorization,
} from "./helpers/shieldedReceiveAuthorization.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  addPerson,
  computeProfileIdentityCommitment,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

const actionData = (overrides = {}) => ({
  inputShardIds: [0n, 0n],
  inputRoots: [0n, 0n],
  inputNullifiers: [0n, 0n],
  periodNullifiers: Array(3).fill(0n),
  outputCommitments: [101n, 102n],
  outputCiphertexts: [`0x${"01".repeat(512)}`, `0x${"02".repeat(512)}`],
  relation0: 0n,
  relation1: 0n,
  asOf: 0n,
  lineageCheckpointId: 0n,
  fundMode: 0n,
  budgetKind: 0n,
  receiveAuthorizations: emptyShieldedReceiveAuthorizations(),
  ...overrides,
});

async function proofFor(pool, action, data, amount = 0n) {
  const signals = buildShieldedPoolPublicSignals({
    action,
    chainId: (await hre.ethers.provider.getNetwork()).chainId,
    poolAddress: await pool.getAddress(),
    ...data,
    amount,
  });
  // The verifier mock isolates the production contracts' checkpoint checks from ZK soundness.
  return hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "uint256[]"],
    [action + 2, signals],
  );
}

describe("Shielded lineage checkpoint integration", function () {
  this.timeout(120_000);

  async function setup() {
    const { deepFamily, lineageIndex, poseidonT3, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    await setupStubVerifiers(hre.ethers, deepFamily);
    const [, claimant, otherManager, recommendedAccount] = await hre.ethers.getSigners();
    const parent = makeTestPerson("Checkpoint parent", { derivedSecretField: 101n });
    const child = makeTestPerson("Checkpoint child", { derivedSecretField: 102n });
    const parentHash = await addPerson(hre.ethers, deepFamily, claimant, null, { person: parent });
    const childHash = await addPerson(hre.ethers, deepFamily, claimant, null, {
      person: child,
      fatherPerson: parent,
      fatherIdentityCommitment: computeProfileIdentityCommitment(hre.ethers, parent),
    });
    const unrelatedHash = await addPerson(hre.ethers, deepFamily, otherManager, null, {
      person: makeTestPerson("Checkpoint unrelated family", { derivedSecretField: 103n }),
    });
    await deepFamily.connect(claimant).endorseVersion(childHash, 1);
    const verifier = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
    await verifier.waitForDeployment();
    const Pool = await hre.ethers.getContractFactory("ShieldedNativePool", {
      libraries: { PoseidonT3: await poseidonT3.getAddress() },
    });
    const receive = await deployMockReceiveAuthorization(hre);
    const pool = await Pool.deploy(
      await lineageIndex.getAddress(),
      await verifier.getAddress(),
      ...receive.constructorArgs,
    );
    await pool.waitForDeployment();
    const deposit = actionData();
    await pool.connect(claimant).shield(100n, deposit, await proofFor(pool, 0, deposit, 100n), {
      value: 100n,
    });
    const updateUnrelated = async (trusted) => {
      const method = trusted ? "addTrustedEndorser" : "removeTrustedEndorser";
      return (
        await deepFamily.connect(otherManager)[method](unrelatedHash, 1, recommendedAccount.address)
      ).wait();
    };
    return {
      deepFamily,
      lineageIndex,
      pool,
      token,
      claimant,
      otherManager,
      parentHash,
      childHash,
      updateUnrelated,
    };
  }

  async function prepare({ pool, lineageIndex }) {
    const data = actionData({
      inputRoots: Array(2).fill((await pool.noteShard(0)).root),
      inputNullifiers: [401n, 402n],
      outputCommitments: [107n, 108n],
      relation0: await lineageIndex.root(0),
      relation1: await lineageIndex.root(1),
      asOf: BigInt((await hre.ethers.provider.getBlock("latest")).timestamp),
      lineageCheckpointId: await lineageIndex.currentCheckpointId(),
    });
    const claim = {
      ...data,
      inputShardIds: data.inputShardIds.slice(0, 1),
      inputRoots: data.inputRoots.slice(0, 1),
      inputNullifiers: data.inputNullifiers.slice(0, 1),
      receiveAuthorizations: emptyShieldedReceiveAuthorizations(),
      periodNullifiers: Array.from({ length: 3 }, (_, i) => 500n + BigInt(i)),
    };
    await authorizeMockReceive(hre, pool, data, 3, [777n, 0n]);
    return {
      data,
      claim,
      fundProof: await proofFor(pool, 1, data),
      claimProof: await proofFor(pool, 2, claim),
    };
  }

  async function expectPreparedAccepted({ pool, claimant }, prepared) {
    await pool.connect(claimant).fund.staticCall(prepared.data, prepared.fundProof);
    await pool.connect(claimant).claim.staticCall(prepared.claim, prepared.claimProof);
  }

  async function expectPreparedExpired({ pool, claimant }, prepared) {
    await expect(
      pool.connect(claimant).fund.staticCall(prepared.data, prepared.fundProof),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
    await expect(
      pool.connect(claimant).claim.staticCall(prepared.claim, prepared.claimProof),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
  }

  it("keeps the same prepared Fund and Claim usable across repeated unrelated updates", async () => {
    const context = await setup();
    const { deepFamily, lineageIndex, pool, token, claimant, otherManager, parentHash, childHash } =
      context;
    const prepared = await prepare(context);
    const managerBalance = await token.balanceOf(otherManager.address);
    await expectPreparedAccepted(context, prepared);
    let retiredAt;
    for (const trusted of [true, false, true, false, true]) {
      await context.updateUnrelated(trusted);
      const checkpoint = await lineageIndex.getCheckpoint(prepared.data.lineageCheckpointId);
      retiredAt ??= checkpoint.retiredAt;
      expect(checkpoint.retiredAt).to.equal(retiredAt);
      expect(await lineageIndex.root(0)).to.equal(prepared.data.relation0);
      expect(await token.balanceOf(otherManager.address)).to.equal(managerBalance);
      expect(await deepFamily.trustedEndorserOf(parentHash, 1, claimant.address)).to.equal(true);
      expect(await deepFamily.endorsedVersionIndex(childHash, claimant.address)).to.equal(1n);
      await expectPreparedAccepted(context, prepared);
    }
    await hre.networkHelpers.time.increaseTo(Number(retiredAt + 899n));
    await expectPreparedAccepted(context, prepared);
    await hre.networkHelpers.time.increaseTo(Number(retiredAt + 900n));
    await expectPreparedExpired(context, prepared);
    expect(await pool.nullifierSpent(401n)).to.equal(false);
  });

  it("expires revoked eligibility at the exact 15-minute boundary", async () => {
    const context = await setup();
    const { deepFamily, lineageIndex, claimant, childHash } = context;
    const prepared = await prepare(context);
    await deepFamily.connect(claimant).cancelEndorsement(childHash);
    const checkpoint = await lineageIndex.getCheckpoint(prepared.data.lineageCheckpointId);
    expect(checkpoint.retiredAt).to.be.greaterThan(0n);
    expect(await deepFamily.endorsedVersionIndex(childHash, claimant.address)).to.equal(0n);
    await hre.networkHelpers.time.increaseTo(Number(checkpoint.retiredAt + 899n));
    await expectPreparedAccepted(context, prepared);
    await hre.networkHelpers.time.increaseTo(Number(checkpoint.retiredAt + 900n));
    await expectPreparedExpired(context, prepared);
  });

  it("does not refresh an old ID when the same roots recur or permit rebinding its proof", async () => {
    const context = await setup();
    const { pool, lineageIndex } = context;
    // Allocate the trusted leaf first, so remove/add returns to the exact same tree shape.
    await context.updateUnrelated(true);
    const prepared = await prepare(context);
    await context.updateUnrelated(false);
    const retired = await lineageIndex.getCheckpoint(prepared.data.lineageCheckpointId);
    await hre.networkHelpers.time.increase(60);
    await context.updateUnrelated(true);
    const laterId = await lineageIndex.currentCheckpointId();
    const later = await lineageIndex.getCheckpoint(laterId);
    expect(laterId).to.be.greaterThan(prepared.data.lineageCheckpointId);
    expect(later.endorsementRoot).to.equal(prepared.data.relation0);
    expect(later.trustedRoot).to.equal(prepared.data.relation1);
    expect(
      (await lineageIndex.getCheckpoint(prepared.data.lineageCheckpointId)).retiredAt,
    ).to.equal(retired.retiredAt);
    await expectPreparedAccepted(context, prepared);
    await expect(
      pool.fund.staticCall({ ...prepared.data, lineageCheckpointId: laterId }, prepared.fundProof),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
    const refreshedTime = later.createdAt;
    await expect(
      pool.fund.staticCall({ ...prepared.data, asOf: refreshedTime }, prepared.fundProof),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
    await expect(
      pool.fund.staticCall(
        { ...prepared.data, lineageCheckpointId: laterId, asOf: refreshedTime },
        prepared.fundProof,
      ),
    ).to.be.revertedWithCustomError(pool, "InvalidReceiveProof");
    const rebound = {
      ...prepared.data,
      lineageCheckpointId: laterId,
      asOf: refreshedTime,
    };
    await authorizeMockReceive(hre, pool, rebound, 3, [777n, 0n]);
    await expect(pool.fund.staticCall(rebound, prepared.fundProof)).to.be.revertedWithCustomError(
      pool,
      "InvalidZKProof",
    );
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 900n));
    await expectPreparedExpired(context, prepared);
    expect(await lineageIndex.currentCheckpointId()).to.equal(laterId);
    await expect(
      pool.claim.staticCall(
        { ...prepared.claim, lineageCheckpointId: laterId },
        prepared.claimProof,
      ),
    ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
  });

  it("rejects roots that were individually known but never belonged to one checkpoint", async () => {
    const context = await setup();
    const { pool, lineageIndex, deepFamily, claimant, childHash } = context;
    const old = await prepare(context);
    await context.updateUnrelated(true);
    await deepFamily.connect(claimant).cancelEndorsement(childHash);
    await deepFamily.connect(claimant).endorseVersion(childHash, 1);
    const current = await prepare(context);
    expect(current.data.relation0).to.not.equal(old.data.relation0);
    expect(current.data.relation1).to.not.equal(old.data.relation1);
    expect(await lineageIndex.isKnownRoot(0, current.data.relation0)).to.equal(true);
    expect(await lineageIndex.isKnownRoot(1, old.data.relation1)).to.equal(true);
    const mixed = { ...current.data, relation1: old.data.relation1 };
    const mixedClaim = { ...current.claim, relation1: old.data.relation1 };
    for (const lineageCheckpointId of [
      0n,
      old.data.lineageCheckpointId,
      current.data.lineageCheckpointId,
    ]) {
      await expect(
        pool.fund.staticCall({ ...mixed, lineageCheckpointId }, await proofFor(pool, 1, mixed)),
      ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
      await expect(
        pool.claim.staticCall(
          { ...mixedClaim, lineageCheckpointId },
          await proofFor(pool, 2, mixedClaim),
        ),
      ).to.be.revertedWithCustomError(pool, "UnknownLineageRoot");
    }
  });
});
