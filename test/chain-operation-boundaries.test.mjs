import { expect } from "chai";
import fs from "node:fs/promises";
import vm from "node:vm";
import { inspect } from "node:util";
import ts from "typescript";
import { getChainErrorDetails, normalizeChainError, runChainRead } from "@deepfamily/chain-client";
import { simulateChainCall } from "../scripts/lib/chainSimulation.mjs";
import { simulateGovernanceCall } from "../tasks/lib/timelockGovernance.mjs";
import { waitForFinalizedTransactions } from "../scripts/lib/releaseEvidence.mjs";

const hash = `0x${"11".repeat(32)}`;
const blockHash = `0x${"22".repeat(32)}`;

describe("contract operation error boundaries", function () {
  it("preserves decodable simulation fields and CLI wording without printing raw envelopes", async function () {
    const data = `0x${"ab".repeat(64)}`;
    const original = Object.freeze(Object.assign(new Error(`reverted with data ${data}`), {
      code: "CALL_EXCEPTION", action: "call", data,
      shortMessage: "execution reverted: UnauthorizedCaller",
      info: { request: { data }, privateKey: "private-simulation-key" },
      cause: { witness: "private-witness" },
    }));
    let failure;
    let reads = 0;
    try {
      await simulateChainCall({ read: async () => { reads++; throw original; }, label: "governance simulation reverted" });
    } catch (error) { failure = error; }
    expect(reads).to.equal(1);
    expect(failure.message).to.equal("governance simulation reverted: execution reverted: UnauthorizedCaller");
    expect(failure.code).to.equal(original.code);
    expect(failure.data).to.equal(data);
    expect(failure.action).to.equal("call");
    expect(getChainErrorDetails(failure)).to.include({ category: "reverted", operation: "read", code: "CALL_EXCEPTION" });
    expect(failure).not.to.have.property("info");
    expect(failure).not.to.have.property("cause");
    for (const displayed of [JSON.stringify(failure), inspect(failure)]) {
      expect(displayed).not.to.include(data);
      expect(displayed).not.to.include("private-simulation-key");
      expect(displayed).not.to.include("private-witness");
    }
    expect(original.message).to.include(data);
  });

  it("routes the actual governance simulator through the canonical error boundary", async function () {
    let failure;
    try {
      await simulateGovernanceCall({
        ethers: { provider: { call: async () => { throw Object.assign(new Error("rpc timeout"), { code: "TIMEOUT" }); } } },
        targetAddress: "target", timelockAddress: "timelock", calldata: "0x1234",
      });
    } catch (error) { failure = error; }
    expect(failure.message).to.include("governance call simulation reverted");
    expect(getChainErrorDetails(failure)).to.include({ category: "network", operation: "read", code: "TIMEOUT" });
  });

  it("retains the canonical nested wallet code after discarding the raw RPC envelope", async function () {
    let failure;
    try {
      await simulateChainCall({
        read: async () => {
          throw Object.assign(new Error("request rejected"), { code: "UNKNOWN_ERROR", info: { error: { code: 4001 } } });
        },
        label: "governance call simulation reverted",
      });
    } catch (error) { failure = error; }
    expect(failure.code).to.equal("UNKNOWN_ERROR");
    expect(failure).not.to.have.property("info");
    expect(getChainErrorDetails(failure)).to.include({ category: "cancelled", code: "ACTION_REJECTED", operation: "read" });
  });

  it("retains confirmed context when finality receipt revalidation fails", async function () {
    let reads = 0;
    let failure;
    try {
      await waitForFinalizedTransactions({
        provider: { getBlock: async () => ({ number: 20 }), getTransactionReceipt: async () => {
          reads++; throw Object.assign(new Error("RPC offline"), { code: "NETWORK_ERROR" });
        } },
        transactions: { mint: { hash, receipt: { status: 1, blockNumber: 10, blockHash } } },
        timeoutMs: 100, pollIntervalMs: 1,
      });
    } catch (error) { failure = error; }
    expect(reads).to.equal(1);
    expect(getChainErrorDetails(failure)).to.include({
      category: "verification", operation: "read", transactionHash: hash,
      transactionConfirmed: true, verificationFailure: "read", retryable: false,
    });
  });

  for (const status of [1, undefined]) {
    it(`retains finality timeout identity without inventing a mismatch (status ${status})`, async function () {
      let failure;
      try {
        await waitForFinalizedTransactions({
          provider: { getBlock: async () => ({ number: 9 }) },
          transactions: { mint: { hash, receipt: { status, blockNumber: 10, blockHash } } },
          timeoutMs: 1, pollIntervalMs: 1,
        });
      } catch (error) { failure = error; }
      expect(failure.message).to.include("Finalized head did not cover release block 10");
      expect(getChainErrorDetails(failure)).to.include({
        category: "verification", operation: "verify", code: "TIMEOUT", transactionHash: hash, retryable: false,
      });
      expect(getChainErrorDetails(failure).transactionConfirmed).to.equal(status === 1 ? true : undefined);
      expect(getChainErrorDetails(failure)).not.to.have.property("verificationFailure");
    });

    it(`associates finalized-head RPC failures with the latest critical transaction (status ${status})`, async function () {
      const latestHash = `0x${"33".repeat(32)}`;
      let reads = 0;
      let failure;
      try {
        await waitForFinalizedTransactions({
          provider: { getBlock: async () => {
            reads++; throw Object.assign(new Error("RPC offline"), { code: "NETWORK_ERROR" });
          } },
          transactions: {
            earlier: { hash, receipt: { status: 1, blockNumber: 9, blockHash } },
            latest: { hash: latestHash, receipt: { status, blockNumber: 10, blockHash } },
          },
          timeoutMs: 100, pollIntervalMs: 1,
        });
      } catch (error) { failure = error; }
      expect(reads).to.equal(1);
      expect(getChainErrorDetails(failure)).to.include({
        operation: "read", transactionHash: latestHash, retryable: false,
        ...(status === 1 ? { category: "verification", transactionConfirmed: true, verificationFailure: "read" } : {}),
      });
      if (status !== 1) expect(getChainErrorDetails(failure).transactionConfirmed).not.to.equal(true);
    });
  }

  it("retains the hash without claiming confirmation when no successful receipt was recorded", async function () {
    let failure;
    try {
      await waitForFinalizedTransactions({
        provider: { getBlock: async () => ({ number: 20 }), getTransactionReceipt: async () => {
          throw Object.assign(new Error("RPC offline"), { code: "NETWORK_ERROR" });
        } },
        transactions: { mint: { hash, receipt: { blockNumber: 10, blockHash } } },
        timeoutMs: 100, pollIntervalMs: 1,
      });
    } catch (error) { failure = error; }
    expect(getChainErrorDetails(failure)).to.include({ transactionHash: hash, retryable: false });
    expect(getChainErrorDetails(failure).transactionConfirmed).not.to.equal(true);
  });

  it("retains successful receipt evidence when the canonical block RPC fails", async function () {
    let failure;
    try {
      await waitForFinalizedTransactions({
        provider: {
          getBlock: async (block) => {
            if (block === "finalized") return { number: 20 };
            throw Object.assign(new Error("RPC offline"), { code: "NETWORK_ERROR" });
          },
          getTransactionReceipt: async () => ({ hash, status: 1, blockNumber: 10, blockHash }),
        },
        transactions: { mint: { hash, receipt: { status: 1, blockNumber: 10, blockHash } } },
        timeoutMs: 100, pollIntervalMs: 1,
      });
    } catch (error) { failure = error; }
    expect(getChainErrorDetails(failure)).to.include({
      category: "verification", operation: "read", transactionHash: hash,
      transactionConfirmed: true, verificationFailure: "read", retryable: false,
    });
  });

  it("keeps reorg rejection distinct from a finality RPC failure", async function () {
    let failure;
    try {
      await waitForFinalizedTransactions({
        provider: { getBlock: async () => ({ number: 20 }), getTransactionReceipt: async () => ({
          hash, status: 1, blockNumber: 11, blockHash,
        }) },
        transactions: { mint: { hash, receipt: { status: 1, blockNumber: 10, blockHash } } },
        timeoutMs: 100, pollIntervalMs: 1,
      });
    } catch (error) { failure = error; }
    expect(failure.message).to.include("receipt changed before finality");
    expect(getChainErrorDetails(failure)).to.include({ category: "verification", operation: "verify", transactionHash: hash, retryable: false });
    expect(getChainErrorDetails(failure).transactionConfirmed).not.to.equal(true);
  });

  it("preserves the injected deployment executor's actual failure stage", async function () {
    const source = await fs.readFile("hardhat/integratedDeployment.mjs", "utf8");
    const parsed = ts.createSourceFile("integratedDeployment.mjs", source, ts.ScriptTarget.Latest, true);
    let initializer;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "executeTransaction") initializer = node.initializer;
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(initializer).to.exist;
    const timeout = normalizeChainError(Object.assign(new Error("timeout"), { code: "TIMEOUT" }), {
      operation: "confirm", transactionHash: hash,
    });
    const execute = vm.runInNewContext(`(${initializer.getText(parsed)})`, {
      transactionExecutor: async () => { throw timeout; },
      normalizeChainError, runChainRead,
      deployer: {}, transactionConfirmations: 3, transactionTimeoutMs: 100,
      transactionReceipts: {},
    });
    let failure;
    try { await execute("deployment", {}); } catch (error) { failure = error; }
    expect(failure).to.equal(timeout);
    expect(getChainErrorDetails(failure)).to.include({ operation: "confirm", transactionHash: hash, code: "TIMEOUT", retryable: false });
  });

  it("covers the local development contract factories in the architecture guard", async function () {
    const source = await fs.readFile("frontend/scripts/update-local-config.mjs", "utf8");
    const parsed = ts.createSourceFile("update-local-config.mjs", source, ts.ScriptTarget.Latest, true);
    const clients = [];
    const rawConstructors = [];
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
          ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === "createChainContract") clients.push(node.name.text);
      if (ts.isNewExpression(node) &&
          (ts.isIdentifier(node.expression) && node.expression.text === "Contract" ||
           ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "Contract")) {
        rawConstructors.push(node.getText(parsed));
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(clients).to.have.members(["deepFamily", "pool", "nativePool", "letters", "factory"]);
    expect(rawConstructors).to.deep.equal([]);
    const guard = await fs.readFile("scripts/check-chain-client-boundaries.mjs", "utf8");
    expect(guard).to.match(/const roots\s*=\s*\[[^;]*"frontend\/scripts"/u);
  });
});
