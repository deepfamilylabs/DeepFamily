import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import {
  deployPublicBudgetFixture,
  publicClaimProof,
  PUBLIC_PERIOD,
  publicCiphertext,
} from "./helpers/publicBudgetFixture.mjs";

describe("Public budgets with private VALUE payouts", function () {
  this.timeout(120000);
  const setup = () => hre.networkHelpers.loadFixture(deployPublicBudgetFixture);
  const topUp = (funding, overrides = {}) => ({
    ...funding,
    budgetId: 1n,
    heirVersionIndex: 0n,
    endorser: hre.ethers.ZeroAddress,
    ...overrides,
  });
  const mature = async (pool, periods = 1n) => {
    const budget = await pool.publicBudgets(1);
    await hre.networkHelpers.time.increaseTo(Number(budget.eligibleFrom + periods * PUBLIC_PERIOD));
  };

  it("funds by personHash without payment keys and keeps a separate public liability", async () => {
    const { pool, token, funding, funder, heirHash, rootHash } = await setup();
    const receipt = await (await pool.fundPublic(funding)).wait();
    const expectedStart = BigInt((await receipt.getBlock()).timestamp) + 7200n;
    const budget = await pool.publicBudgets(1);
    expect(budget.createdBy).to.equal(funder.address);
    expect(budget.heirPersonHash).to.equal(heirHash);
    expect(budget.rootPersonHash).to.equal(rootHash);
    expect(budget.eligibleFrom).to.equal(expectedStart);
    expect(budget.nextPeriod).to.equal(0n);
    expect(await pool.publicBudgetCount()).to.equal(1n);
    expect(await pool.totalPublicBudget()).to.equal(300n);
    expect(await pool.totalShielded()).to.equal(0n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(300n);
    expect(await pool.queryFilter(pool.filters.NoteAppended())).to.have.length(0);
    const events = await pool.queryFilter(pool.filters.PublicBudgetFunded());
    expect(events[0].args.amount).to.equal(300n);
    expect(events[0].args.remaining).to.equal(300n);
  });

  it("lets another donor add whole periods after eligibility changes, preserving all terms", async () => {
    const { pool, funding, other, deepFamily, heirHash, funder } = await setup();
    await pool.fundPublic(funding);
    const original = await pool.publicBudgets(1);
    await deepFamily.cancelEndorsement(heirHash);
    await pool.connect(other).fundPublic(topUp(funding, { budgetPeriods: 2n }));
    const budget = await pool.publicBudgets(1);
    expect(budget.createdBy).to.equal(funder.address);
    expect(budget.eligibleFrom).to.equal(original.eligibleFrom);
    expect(budget.nextPeriod).to.equal(0n);
    expect(budget.remaining).to.equal(500n);
    expect(await pool.publicBudgetCount()).to.equal(1n);
    for (const changed of [
      { amountPerPeriod: 101n },
      { rootVersionIndex: 2n },
      { heirPersonHash: funding.rootPersonHash },
      { rootPersonHash: heirHash },
      { heirVersionIndex: 1n },
      { endorser: funder.address },
    ])
      await expect(pool.fundPublic(topUp(funding, changed))).to.be.revertedWithCustomError(
        pool,
        "InvalidPublicBudgetData",
      );
    await expect(pool.fundPublic(topUp(funding, { budgetId: 2n }))).to.be.revertedWithCustomError(
      pool,
      "UnknownPublicBudget",
    );
  });

  it("rejects invalid first funding, zero budgets, and overflowing deposits without state changes", async () => {
    const { pool, funding, other } = await setup();
    for (const changed of [
      { rootPersonHash: funding.heirPersonHash },
      { rootVersionIndex: 0n },
      { heirVersionIndex: 0n },
      { endorser: other.address },
    ])
      await expect(pool.fundPublic({ ...funding, ...changed })).to.be.revertedWithCustomError(
        pool,
        "IneligiblePublicBeneficiary",
      );
    for (const changed of [
      { amountPerPeriod: 0n },
      { budgetPeriods: 0n },
      { amountPerPeriod: (1n << 128n) - 1n, budgetPeriods: 2n },
    ])
      await expect(pool.fundPublic({ ...funding, ...changed })).to.be.revertedWithCustomError(
        pool,
        "InvalidPublicBudgetData",
      );
    expect(await pool.publicBudgetCount()).to.equal(0n);
    expect(await pool.totalPublicBudget()).to.equal(0n);
  });

  it("rejects an overflowing refill and a fee on deposit, rolling back the new plan", async () => {
    const { pool, token, poolFactory, lineageIndex, verifier, funding, funder } = await setup();
    const maximum = (1n << 128n) - 1n;
    await token.mint(funder.address, maximum);
    const huge = { ...funding, amountPerPeriod: maximum, budgetPeriods: 1n };
    await pool.fundPublic(huge);
    await expect(pool.fundPublic(topUp(huge))).to.be.revertedWithCustomError(
      pool,
      "InvalidPublicBudgetData",
    );
    expect((await pool.publicBudgets(1)).remaining).to.equal(maximum);
    const feeToken = await hre.ethers.deployContract("ShieldedPoolFeeTokenMock");
    const feePool = await poolFactory.deploy(
      await feeToken.getAddress(),
      await lineageIndex.getAddress(),
      await verifier.getAddress(),
    );
    await feeToken.mint(funder.address, 1000n);
    await feeToken.approve(await feePool.getAddress(), 1000n);
    await expect(feePool.fundPublic(funding)).to.be.revertedWithCustomError(
      feePool,
      "UnexpectedTokenTransfer",
    );
    expect(await feePool.publicBudgetCount()).to.equal(0n);
    expect(await feePool.totalPublicBudget()).to.equal(0n);
    expect(await feeToken.balanceOf(await feePool.getAddress())).to.equal(0n);
    expect(await feeToken.balanceOf(funder.address)).to.equal(1000n);
  });

  it("claims up to twelve sequential full periods and moves custody into private liability", async () => {
    const { pool, token, funding, claim, heirIdentity, other, heirHash } = await setup();
    await pool.fundPublic({ ...funding, budgetPeriods: 15n });
    const data = { ...claim, claimCount: 12 };
    const proof = await publicClaimProof(pool, data, heirIdentity, 1200n);
    await expect(pool.claimPublic(data, proof)).to.be.revertedWithCustomError(
      pool,
      "PublicBudgetNotMature",
    );
    await mature(pool, 12n);
    await expect(pool.connect(other).claimPublic(data, proof))
      .to.emit(pool, "PublicBudgetClaimed")
      .withArgs(1n, heirHash, 0n, 12, 1200n, 300n);
    expect((await pool.publicBudgets(1)).nextPeriod).to.equal(12n);
    expect(await pool.totalPublicBudget()).to.equal(300n);
    expect(await pool.totalShielded()).to.equal(1200n);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(1500n);
    const actions = await pool.queryFilter(pool.filters.ActionExecuted());
    expect(actions[0].args.action).to.equal(5n);
    expect(actions[0].args.inputShardId0).to.equal(0n);
    expect(await pool.queryFilter(pool.filters.NoteAppended())).to.have.length(2);
    await expect(pool.claimPublic(data, proof)).to.be.revertedWithCustomError(
      pool,
      "InvalidPublicBudgetData",
    );
    await mature(pool, 16n);
    await expect(
      pool.claimPublic({ ...claim, firstPeriod: 12n, claimCount: 4 }, "0x"),
    ).to.be.revertedWithCustomError(pool, "InsufficientPublicBudget");
  });

  it("checks active child endorsement and trusted root source again at claim time", async () => {
    const { pool, funding, claim, deepFamily, heirHash, rootHash, funder } = await setup();
    await pool.fundPublic(funding);
    await mature(pool);
    const branch = await hre.networkHelpers.takeSnapshot();
    await deepFamily.cancelEndorsement(heirHash);
    await expect(pool.claimPublic(claim, "0x")).to.be.revertedWithCustomError(
      pool,
      "IneligiblePublicBeneficiary",
    );
    await branch.restore();
    await deepFamily.removeTrustedEndorser(rootHash, 1, funder.address);
    await expect(pool.claimPublic(claim, "0x")).to.be.revertedWithCustomError(
      pool,
      "IneligiblePublicBeneficiary",
    );
    expect((await pool.publicBudgets(1)).nextPeriod).to.equal(0n);
    expect(await pool.totalShielded()).to.equal(0n);
  });

  it("allows a current re-endorsed child version without restarting its original budget clock", async () => {
    const { pool, funding, claim, deepFamily, heirHash, heirIdentity, addHeirVersion } =
      await setup();
    await pool.fundPublic(funding);
    const before = await pool.publicBudgets(1);
    await addHeirVersion("public-child-renewed");
    await deepFamily.endorseVersion(heirHash, 2);
    await mature(pool);
    await expect(pool.claimPublic(claim, "0x")).to.be.revertedWithCustomError(
      pool,
      "IneligiblePublicBeneficiary",
    );
    const data = { ...claim, heirVersionIndex: 2n };
    await pool.claimPublic(data, await publicClaimProof(pool, data, heirIdentity, 100n));
    expect((await pool.publicBudgets(1)).eligibleFrom).to.equal(before.eligibleFrom);
  });

  it("binds identity, ledger, amount, outputs and ciphertext, rejecting invalid data before effects", async () => {
    const { pool, funding, claim, heirIdentity, rootIdentity } = await setup();
    await pool.fundPublic(funding);
    await pool.fundPublic(funding);
    await mature(pool, 3n);
    const proof = await publicClaimProof(pool, claim, heirIdentity, 100n);
    for (const changed of [
      { budgetId: 2n },
      { claimCount: 2 },
      { outputCommitments: [103n, 104n] },
      { outputCiphertexts: [publicCiphertext("03"), publicCiphertext("02")] },
    ])
      await expect(pool.claimPublic({ ...claim, ...changed }, proof)).to.be.revertedWithCustomError(
        pool,
        "InvalidZKProof",
      );
    await expect(
      pool.claimPublic(claim, await publicClaimProof(pool, claim, rootIdentity, 100n)),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    for (const changed of [{ firstPeriod: 1n }, { claimCount: 0 }, { claimCount: 13 }])
      await expect(pool.claimPublic({ ...claim, ...changed }, "0x")).to.be.revertedWithCustomError(
        pool,
        "InvalidPublicBudgetData",
      );
    await expect(pool.claimPublic({ ...claim, budgetId: 99n }, "0x")).to.be.revertedWithCustomError(
      pool,
      "UnknownPublicBudget",
    );
    await expect(
      pool.claimPublic({ ...claim, outputCommitments: [101n, 101n] }, "0x"),
    ).to.be.revertedWithCustomError(pool, "DuplicateCommitment");
    await expect(
      pool.claimPublic({ ...claim, outputCommitments: [0n, 102n] }, "0x"),
    ).to.be.revertedWithCustomError(pool, "InvalidFieldElement");
    await expect(
      pool.claimPublic({ ...claim, outputCiphertexts: ["0x01", publicCiphertext("02")] }, "0x"),
    ).to.be.revertedWithCustomError(pool, "InvalidCiphertext");
    expect(await pool.totalPublicBudget()).to.equal(600n);
    expect(await pool.totalShielded()).to.equal(0n);
  });
});
