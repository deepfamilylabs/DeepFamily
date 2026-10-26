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
    "circuits/budget_capability.circom", "circuits/budget_claim.circom", "packages/protocol-core/receive-code.js",
    "test/fixtures/receive-revocation-gas.mjs", "test/receive-revocation-gas.test.mjs",
    "scripts/benchmark-revocation-gas.mjs",
  ].map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex")]));
}

describe("Receive direct role-index gas and latest-state regression", function () {
  this.timeout(1_800_000);
  after(async () => {
    await globalThis.curve_bn128?.terminate?.();
    delete globalThis.curve_bn128;
  });

  it("reads role-index state directly for native/ERC20 transactions and immediately rejects new revocations", async function () {
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
      schemaVersion: 3,
      protocol: "deepfamily.receive",
      measurementModel: "direct-role-index-status-with-echo-money-and-source-proofs",
      directRoleStatusAcceptance: true,
      preparationProofs: 0, preparationTransactions: 0,
      fullMoneyCryptographicAcceptance: false,
      productionCapacityEstablished: false,
      limitations: [
        "The actual Source/Registry/native/ERC20 contracts perform fixed role-index lookups; money, source-fact/source-trust and family/lineage proofs remain explicit mocks.",
        "Full-money Groth16 correctness is tested separately; these gas values are not full cryptographic acceptance or a strict transaction lower bound.",
        "History is created through publication/revocation entrypoints without storage injection; each pool starts with six notes, not a full-depth note tree.",
        "The suite does not claim one million on-chain revocations were executed. Opcode traces independently verify one storage read for each role status query.",
        "Source audit-history storage grows with revocations, but readers do not scan it or prepare per-code proofs/transactions.",
        "The configured gas budget is local, not a live-chain transaction limit or production safety cap.",
      ],
      createdAt: new Date().toISOString(),
      runtime: { node: process.version,
        hardhat: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/hardhat/package.json"))).version },
      chainId: String(fixture.chainId), gasLimit: String(gasLimit), headroomBps: Number(headroomBps),
      countsPerRole: counts, sourceSha256: sourceHashes(),
      rows: [], queryRows: [],
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
      try { receipt = await (await source.isRoleRevoked.send(role, fixture.roleIndices[role], { gasLimit })).wait(); }
      catch (error) { receipt = error.receipt; if (!receipt) throw error; }
      assert.equal(receipt.status, 1);
      assert.equal(await source.isRoleRevoked(role, fixture.roleIndices[role]), expected === "revoked");
      const trace = await provider.send("debug_traceTransaction", [receipt.hash, { disableMemory: true, disableStack: true, disableStorage: true }]);
      const storageReads = trace.structLogs.filter(step => step.op === "SLOAD").length;
      assert.equal(storageReads, 1, "Each role status query must read exactly one mapping slot");
      report.queryRows.push({ role, scenario, revocationCount: String(await source.revokedRoleCount(role)),
        outcome: expected, storageReads, gasUsed: String(receipt.gasUsed), transactionHash: receipt.hash });
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
        } else throw new Error(`Unexpected rejection: ${decoded.name}`);
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
      if (outcome === "accepted") assert.ok(gasWithHeadroom <= gasLimit, "Direct-status transaction exceeds local budget");
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
    for (const count of counts) {
      await fixture.seedTo(count);
      for (const role of [0, 1, 2]) await measureQuery(role, "valid", "direct-status");
      await measureAll("direct-status");
      const snapshot = await context.networkHelpers.takeSnapshot();
      for (const role of [0, 1, 2]) {
        await snapshot.restore();
        await fixture.revokeTarget(role);
        await measureQuery(role, "revoked", "target-revoked-after-business-proof");
        assert.equal(await registry.verifyReceive(fixture.code, fixture.codeProof), true);
        await measureAll("target-revoked-after-business-proof", "qualification-revoked", role);
      }
      await snapshot.restore();
      if (benchmark) console.log(`[revocation-gas] ${count}/role; zero preparation proofs or transactions; one status SLOAD per role`);
    }
    report.gasSpread = [];
    for (const asset of ["native", "erc20"]) for (const operation of ["first", "append", "claim"]) {
      const values = report.rows.filter(row => row.asset === asset && row.operation === operation
        && row.scenario === "direct-status").map(row => BigInt(row.gasUsed));
      const min = values.reduce((a, b) => a < b ? a : b), max = values.reduce((a, b) => a > b ? a : b);
      assert.ok(max - min < 50_000n, "Direct status transaction gas must not grow with total history");
      report.gasSpread.push({ asset, operation, min: String(min), max: String(max), spread: String(max - min) });
    }
    if (benchmark) {
      const output = process.env.RECEIVE_REVOCATION_GAS_REPORT;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      console.table(report.rows.filter(row => row.scenario === "direct-status").map(row => ({ asset: row.asset,
        operation: row.operation, countPerRole: row.revocationsPerRole[0], gas: row.gasUsed, outcome: row.outcome })));
      console.log(`[revocation-gas] Direct-status / echo-money report: ${path.relative(ROOT, output)}`);
    }
    await connection.close();
  });

  it("does not share status across unrelated roles and keeps ordinary receiving valid after a role revocation", async () => {
    const connection = await hre.network.create({ network: "default" });
    const fixture = await createReceiveRevocationGasFixture({ ethers: connection.ethers, networkHelpers: connection.networkHelpers });
    await fixture.revokeTarget(0);
    assert.equal(await fixture.source.isRoleRevoked(0, fixture.roleIndices[0]), true);
    assert.equal(await fixture.source.isRoleRevoked(1, fixture.roleIndices[1]), false);
    assert.equal(await fixture.registry.verifyReceive(fixture.code, fixture.codeProof), true);
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
