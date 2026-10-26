import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { parseRevocationGasArguments } from "../scripts/benchmark-revocation-gas.mjs";
import { createReceiveRevocationGasFixture } from "./fixtures/receive-revocation-gas.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const benchmark = process.env.RECEIVE_REVOCATION_GAS_BENCHMARK === "1";
function failureData(error) {
  for (const value of [error.data, error.error?.data, error.info?.error?.data]) {
    if (typeof value === "string") return value;
    if (typeof value?.data === "string") return value.data;
  }
  return "0x";
}
function sourceHashes() {
  return Object.fromEntries([
    "contracts/EligibilitySource.sol", "contracts/ReceiveRegistry.sol", "contracts/ShieldedPoolCore.sol",
    "contracts/ShieldedNativePool.sol", "contracts/ShieldedErc20Pool.sol", "hardhat.config.mjs",
    "circuits/eligibility_revocation_scan.circom", "packages/protocol-core/revocation.js",
    "test/fixtures/receive-revocation-gas.mjs", "test/receive-revocation-gas.test.mjs",
    "scripts/benchmark-revocation-gas.mjs",
  ].map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex")]));
}

describe("Receive bounded revocation gas and latest-state regression", function () {
  this.timeout(1_800_000);
  after(async () => {
    await globalThis.curve_bn128?.terminate?.();
    delete globalThis.curve_bn128;
  });

  it("uses real scan proofs for bounded native/ERC20 transactions and immediately rejects new revocations", async function () {
    const counts = benchmark ? process.env.RECEIVE_REVOCATION_GAS_COUNTS.split(",").map(Number) : [0, 9];
    const gasLimit = BigInt(benchmark ? process.env.RECEIVE_REVOCATION_GAS_LIMIT : 15_000_000);
    const headroomBps = BigInt(benchmark ? process.env.RECEIVE_REVOCATION_GAS_HEADROOM_BPS : 2000);
    const connection = await hre.network.create({ network: "default",
      override: { throwOnTransactionFailures: false, allowUnlimitedContractSize: false } });
    const context = { ethers: connection.ethers, networkHelpers: connection.networkHelpers };
    const fixture = await createReceiveRevocationGasFixture(context);
    const { source, registry, pools } = fixture;
    const provider = context.ethers.provider;
    const report = {
      schemaVersion: 2,
      protocol: "deepfamily.receive",
      measurementModel: "real-groth16-revocation-scan-with-echo-money-and-source-proofs",
      revocationScanCryptographicAcceptance: true,
      fullMoneyCryptographicAcceptance: false,
      productionCapacityEstablished: false,
      limitations: [
        "Revocation interval proofs and their fixed Solidity verifier are real Groth16; money, source-fact/source-trust and family/lineage authentication remain explicit mocks.",
        "These complete Source/Registry/native/ERC20 pool transactions measure the bounded revocation integration, not full-money Groth16 gas or a strict full-transaction lower bound.",
        "Source history is created through publication/revocation entrypoints without storage injection; each pool starts with six notes.",
        "First preparation for a new role/nonce/tag remains O(history/32) proofs and transactions; only individual preparation and final funds transactions have bounded work.",
        "Proof timings and RSS are measured in Node; they do not establish browser performance or production capacity.",
        "Progress storage estimates count data words only, excluding mapping trie overhead, and exclude shared log checkpoint storage.",
        "The configured gas budget is local, not a live-chain transaction limit or production safety cap.",
      ],
      createdAt: new Date().toISOString(),
      runtime: { node: process.version,
        hardhat: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/hardhat/package.json"))).version },
      chainId: String(fixture.chainId), gasLimit: String(gasLimit), headroomBps: Number(headroomBps),
      countsPerRole: counts, sourceSha256: sourceHashes(),
      maxBatchEntries: Number(await source.MAX_REVOCATION_BATCH()),
      maxLiveTailPerRole: Number(await source.MAX_REVOCATION_TAIL()),
      rows: [], queryRows: [], preparationRows: [], cacheReuseRows: [],
    };
    function parseFailure(data) {
      for (const contract of [registry, source]) {
        try { const decoded = contract.interface.parseError(data); if (decoded) return decoded; } catch {}
      }
      return null;
    }
    async function measureQuery(role, expected, scenario) {
      const snapshot = await context.networkHelpers.takeSnapshot();
      let receipt;
      try { receipt = await (await source.isRoleRevoked.send(role, fixture.nonce, fixture.tags[role], { gasLimit })).wait(); }
      catch (error) { receipt = error.receipt; if (!receipt) throw error; }
      if (expected === "needs-preparation") {
        assert.equal(receipt.status, 0);
        await assert.rejects(() => source.isRoleRevoked(role, fixture.nonce, fixture.tags[role]), error =>
          parseFailure(failureData(error))?.name === "RevocationStateNotPrepared");
      } else {
        assert.equal(receipt.status, 1);
        assert.equal(await source.isRoleRevoked(role, fixture.nonce, fixture.tags[role]), expected === "revoked");
      }
      report.queryRows.push({ role, scenario, revocationCount: String(await source.revokedRoleCount(role)),
        checkedThrough: String(await source.roleScanProgress(role, fixture.nonce, fixture.tags[role])),
        outcome: expected, gasUsed: String(receipt.gasUsed), transactionHash: receipt.hash });
      await snapshot.restore();
    }
    async function measure(entry, operationName, scenario, expected = "accepted", expectedRole = null) {
      const operation = entry.operations[operationName], pool = entry.pool, method = pool[operation.method];
      const countsBefore = await Promise.all([0, 1, 2].map(role => source.revokedRoleCount(role)));
      const before = { shard: Array.from(await pool.noteShard(0)), nullifiers: await pool.nullifierCount(),
        budget: Array.from(await pool.budgetRecords(operation.budgetKey)),
        collateral: entry.asset === "native" ? await provider.getBalance(await pool.getAddress())
          : await fixture.token.balanceOf(await pool.getAddress()) };
      for (const nullifier of operation.inputNullifiers) assert.equal(await pool.nullifierSpent(nullifier), false);
      for (const commitment of operation.outputCommitments) assert.equal(await pool.commitmentExists(commitment), false);
      let receipt;
      try { receipt = await (await method(...operation.args, { gasLimit })).wait(); }
      catch (error) { receipt = error.receipt; if (!receipt) throw error; }
      let outcome;
      if (receipt.status === 1) {
        outcome = "accepted";
        for (const nullifier of operation.inputNullifiers) assert.equal(await pool.nullifierSpent(nullifier), true);
        for (const commitment of operation.outputCommitments) assert.equal(await pool.commitmentExists(commitment), true);
        if (operation.periodNullifier) assert.equal(await pool.nullifierSpent(operation.periodNullifier), true);
        assert.equal((await pool.noteShard(0)).size, before.shard[0] + 2n);
        const budget = await pool.budgetRecords(operation.budgetKey);
        assert.equal(budget.exists, true);
        if (operationName !== "first") assert.deepEqual(Array.from(budget), before.budget);
      } else {
        let failure;
        try { await method.staticCall(...operation.args, { gasLimit }); } catch (error) { failure = error; }
        assert.ok(failure, "A reverted transaction must fail from the unchanged state");
        const decoded = parseFailure(failureData(failure));
        assert.ok(decoded, "Failure must have a specific bounded rejection, not exhausted gas");
        if (decoded.name === "QualificationRevoked") {
          outcome = "qualification-revoked";
          assert.equal(Number(decoded.args[0]), expectedRole);
        } else {
          assert.equal(decoded.name, "RevocationStateNotPrepared");
          outcome = "needs-preparation";
        }
        assert.deepEqual(Array.from(await pool.noteShard(0)), before.shard);
        assert.equal(await pool.nullifierCount(), before.nullifiers);
        assert.deepEqual(Array.from(await pool.budgetRecords(operation.budgetKey)), before.budget);
        for (const nullifier of operation.inputNullifiers) assert.equal(await pool.nullifierSpent(nullifier), false);
        for (const commitment of operation.outputCommitments) assert.equal(await pool.commitmentExists(commitment), false);
        if (operation.periodNullifier) assert.equal(await pool.nullifierSpent(operation.periodNullifier), false);
      }
      assert.equal(outcome, expected);
      const collateral = entry.asset === "native" ? await provider.getBalance(await pool.getAddress())
        : await fixture.token.balanceOf(await pool.getAddress());
      assert.equal(collateral, before.collateral);
      const gasWithHeadroom = (receipt.gasUsed * (10_000n + headroomBps) + 9999n) / 10_000n;
      if (outcome === "accepted") assert.ok(gasWithHeadroom <= gasLimit, "Prepared transaction exceeds local budget");
      report.rows.push({ asset: entry.asset, operation: operationName, scenario, revokedRole: expectedRole,
        revocationsPerRole: countsBefore.map(String), outcome, gasUsed: String(receipt.gasUsed),
        gasWithHeadroom: String(gasWithHeadroom), fitsLocalBudgetWithHeadroom: outcome === "accepted" && gasWithHeadroom <= gasLimit,
        transactionHash: receipt.hash });
    }
    async function measureAll(scenario, expected = "accepted", role = null) {
      const snapshot = await context.networkHelpers.takeSnapshot();
      for (const entry of pools) for (const name of ["first", "append", "claim"]) {
        await snapshot.restore();
        await measure(entry, name, scenario, expected, role);
      }
      await snapshot.restore();
    }
    let checkedOverflow = false;
    for (const count of counts) {
      await fixture.seedTo(count);
      const unprepared = await Promise.all([0, 1, 2].map(async role =>
        await source.revokedRoleCount(role) - await source.roleScanProgress(role, fixture.nonce, fixture.tags[role]) > 8n));
      const plans = await fixture.buildScanPlans();
      if (plans.length) {
        if (unprepared.some(Boolean)) await measureAll("unprepared-prefix", "needs-preparation");
        // Generate once before revocation, then submit the authenticated historical prefixes.
        const snapshot = await context.networkHelpers.takeSnapshot();
        for (const role of [0, 1, 2]) {
          await snapshot.restore();
          await fixture.revokeTarget(role);
          await fixture.submitScanPlans(plans);
          await measureQuery(role, "revoked", "target-revoked-after-proof-generation");
          await measureAll("target-revoked-after-proof-generation", "qualification-revoked", role);
        }
        await snapshot.restore();
      }
      const prepared = await fixture.submitScanPlans(plans);
      report.preparationRows.push(...prepared.map(row => ({ ...row, countPerRole: count })));
      for (const role of [0, 1, 2]) await measureQuery(role, "valid", "prepared-prefix");
      await measureAll("prepared-prefix");
      const reused = await fixture.buildScanPlans();
      assert.deepEqual(reused, [], "A fully prepared status must not require repeated proofs or transactions");
      report.cacheReuseRows.push({ countPerRole: count, additionalProofs: reused.length, additionalPrepareTransactions: 0 });
      const snapshot = await context.networkHelpers.takeSnapshot();
      for (const role of [0, 1, 2]) {
        await snapshot.restore();
        await fixture.revokeTarget(role);
        await measureQuery(role, "revoked", "target-revoked-after-cache-update");
        assert.equal(await registry.verifyReceive(fixture.code, fixture.codeProof), true);
        await measureAll("target-revoked-after-cache-update", "qualification-revoked", role);
      }
      await snapshot.restore();
      if (!checkedOverflow) {
        await fixture.seedTo(count + 9);
        await measureQuery(0, "needs-preparation", "latest-tail-overflow");
        await measureAll("latest-tail-overflow", "needs-preparation");
        await snapshot.restore();
        checkedOverflow = true;
      }
      if (benchmark) console.log(`[revocation-gas] ${count}/role; ${plans.length} new interval proofs, final funds transactions bounded`);
    }
    report.gasSpread = [];
    for (const asset of ["native", "erc20"]) for (const operation of ["first", "append", "claim"]) {
      const values = report.rows.filter(row => row.asset === asset && row.operation === operation
        && row.scenario === "prepared-prefix").map(row => BigInt(row.gasUsed));
      const min = values.reduce((a, b) => a < b ? a : b), max = values.reduce((a, b) => a > b ? a : b);
      assert.ok(max - min < 50_000n, "Fully prepared final transaction gas must not grow with total history");
      report.gasSpread.push({ asset, operation, min: String(min), max: String(max), spread: String(max - min) });
    }
    report.preparationTotals = {
      generatedProofs: report.preparationRows.length,
      prepareTransactions: report.preparationRows.length,
      proofMilliseconds: report.preparationRows.reduce((sum, row) => sum + row.proofMilliseconds, 0),
      gasUsed: String(report.preparationRows.reduce((sum, row) => sum + BigInt(row.gasUsed), 0n)),
      newProgressStorageWords: report.preparationRows.reduce((sum, row) => sum + row.newProgressStorageWords, 0),
      note: "Totals count the normal incremental preparation path; adversarial snapshot branches reuse those proofs and are excluded.",
    };
    if (benchmark) {
      const output = process.env.RECEIVE_REVOCATION_GAS_REPORT;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      console.table(report.rows.filter(row => row.scenario === "prepared-prefix").map(row => ({ asset: row.asset,
        operation: row.operation, countPerRole: row.revocationsPerRole[0], gas: row.gasUsed, outcome: row.outcome })));
      console.log(`[revocation-gas] Real-scan / echo-money report: ${path.relative(ROOT, output)}`);
    }
    await connection.close();
  });

  it("rejects a target revoked before preparation and accepts no incomplete non-revocation proof", async () => {
    const connection = await hre.network.create({ network: "default" });
    const fixture = await createReceiveRevocationGasFixture({ ethers: connection.ethers,
      networkHelpers: connection.networkHelpers });
    await fixture.revokeTarget(0);
    await fixture.seedTo(9);
    await assert.rejects(() => fixture.buildScanPlans(), error => error.code === "QUALIFICATION_REVOKED");
    assert.equal(await fixture.source.roleScanProgress(0, fixture.nonce, fixture.tags[0]), 0n);
    await connection.close();
  });

  it("rejects ambiguous benchmark scales and excessive local gas limits", () => {
    assert.deepEqual(parseRevocationGasArguments(["--counts", "0,8,32"]).counts, [0, 8, 32]);
    for (const args of [["--counts", "1,2"], ["--counts", "0,2,2"], ["--counts", "0,32,8"],
      ["--counts", "0,10001"], ["--counts", "0,1.5"], ["--gas-limit", "16000000"],
      ["--headroom-bps", "10001"], ["--output"], ["--counts", "0", "--counts", "0,2"]])
      assert.throws(() => parseRevocationGasArguments(args));
  });
});
