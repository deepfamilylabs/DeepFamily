import assert from "node:assert/strict";
import { Interface } from "ethers";
import hre from "hardhat";

import {
  ALLOCATE_SELECTOR,
  CLAIM_SELECTOR,
  parseShieldedReceiptArguments,
  verifyShieldedTestnetReceipts,
} from "../scripts/zk-shielded-testnet-receipts.mjs";

const poolAddress = "0x0000000000000000000000000000000000000071";
const allocationTxHash = `0x${"11".repeat(32)}`;
const claim12TxHash = `0x${"22".repeat(32)}`;
const allocationBlockHash = `0x${"aa".repeat(32)}`;
const claimBlockHash = `0x${"bb".repeat(32)}`;

function fixtureProvider(change = () => {}) {
  const fixture = {
    chainId: "0x47",
    providerChainId: 71n,
    code: "0x6000",
    transactions: {
      [allocationTxHash]: {
        hash: allocationTxHash,
        chainId: 71n,
        to: poolAddress,
        data: `${ALLOCATE_SELECTOR}abcd`,
        gasLimit: 900_000n,
        blockHash: allocationBlockHash,
      },
      [claim12TxHash]: {
        hash: claim12TxHash,
        chainId: 71n,
        to: poolAddress,
        data: `${CLAIM_SELECTOR}abcd`,
        gasLimit: 1_500_000n,
        blockHash: claimBlockHash,
      },
    },
    receipts: {
      [allocationTxHash]: {
        hash: allocationTxHash,
        to: poolAddress,
        status: 1,
        blockHash: allocationBlockHash,
        blockNumber: 10,
        gasUsed: 800_000n,
      },
      [claim12TxHash]: {
        hash: claim12TxHash,
        to: poolAddress,
        status: 1,
        blockHash: claimBlockHash,
        blockNumber: 11,
        gasUsed: 1_200_000n,
      },
    },
    blocks: {
      [allocationBlockHash]: { hash: allocationBlockHash, number: 10, gasLimit: 30_000_000n },
      [claimBlockHash]: { hash: claimBlockHash, number: 11, gasLimit: 30_000_000n },
    },
  };
  change(fixture);
  const calls = [];
  const provider = {
    send: async (method) => {
      calls.push(method);
      assert.equal(method, "eth_chainId");
      return fixture.chainId;
    },
    getNetwork: async () => {
      calls.push("getNetwork");
      return { chainId: fixture.providerChainId };
    },
    getCode: async (address) => {
      calls.push("getCode");
      assert.equal(address, poolAddress);
      return fixture.code;
    },
    getTransaction: async (hash) => {
      calls.push("getTransaction");
      return fixture.transactions[hash] ?? null;
    },
    getTransactionReceipt: async (hash) => {
      calls.push("getTransactionReceipt");
      return fixture.receipts[hash] ?? null;
    },
    getBlock: async (hash) => {
      calls.push("getBlock");
      return fixture.blocks[hash] ?? null;
    },
  };
  return { provider, calls };
}

const input = (provider) => ({ provider, poolAddress, allocationTxHash, claim12TxHash });

describe("shielded chain-71 receipt observer", function () {
  it("uses the pool's actual allocate and claim ABI selectors", async function () {
    const artifact = await hre.artifacts.readArtifact("ShieldedDeepPool");
    const abi = new Interface(artifact.abi);
    assert.equal(ALLOCATE_SELECTOR, abi.getFunction("allocate").selector);
    assert.equal(CLAIM_SELECTOR, abi.getFunction("claim").selector);
  });

  it("requires explicit RPC, pool, and two distinct hashes", function () {
    assert.throws(() => parseShieldedReceiptArguments([]), /Usage:/);
    assert.throws(
      () =>
        parseShieldedReceiptArguments([
          "--rpc",
          "file:///tmp/fake",
          "--pool",
          poolAddress,
          "--allocation-tx",
          allocationTxHash,
          "--claim12-tx",
          claim12TxHash,
        ]),
      /HTTP\(S\)/,
    );
    assert.throws(
      () =>
        parseShieldedReceiptArguments([
          "--rpc",
          "https://rpc.example",
          "--pool",
          poolAddress,
          "--allocation-tx",
          allocationTxHash,
          "--claim12-tx",
          allocationTxHash,
        ]),
      /distinct/,
    );
  });

  it("cross-checks two successful pool receipts and reports only observable facts", async function () {
    const { provider, calls } = fixtureProvider();
    const result = await verifyShieldedTestnetReceipts(input(provider));
    assert.equal(result.chainId, 71);
    assert.equal(result.rpcChecks, "passed");
    assert.equal(result.releaseEvidence, false);
    assert.equal(result.privateClaimedPeriodsChecked, false);
    assert.equal(result.fullPathDepthChecked, false);
    assert.equal(result.transactions.allocation.gasUsed, "800000");
    assert.equal(result.transactions.claim12.transactionGasLimit, "1500000");
    assert.equal(result.transactions.claim12.blockGasLimit, "30000000");
    assert.deepEqual(calls.slice(0, 2).sort(), ["eth_chainId", "getNetwork"]);
    assert.equal(calls.filter((method) => method === "getTransaction").length, 2);
    assert.ok(!calls.includes("sendTransaction"));
  });

  it("rejects an RPC with the wrong raw or provider chain ID before receipt lookups", async function () {
    for (const change of [
      (fixture) => {
        fixture.chainId = "0x406";
      },
      (fixture) => {
        fixture.providerChainId = 1030n;
      },
    ]) {
      const { provider, calls } = fixtureProvider(change);
      await assert.rejects(verifyShieldedTestnetReceipts(input(provider)), /requires chain ID 71/);
      assert.ok(!calls.includes("getTransaction"));
    }
  });

  it("rejects a failed claim, wrong target or selector, and inconsistent gas or block", async function () {
    const cases = [
      [
        (fixture) => {
          fixture.receipts[claim12TxHash].status = 0;
        },
        /did not succeed/,
      ],
      [
        (fixture) => {
          fixture.transactions[allocationTxHash].to = "0x0000000000000000000000000000000000000002";
        },
        /selected shielded pool/,
      ],
      [
        (fixture) => {
          fixture.transactions[claim12TxHash].data = `${ALLOCATE_SELECTOR}abcd`;
        },
        /wrong pool method selector/,
      ],
      [
        (fixture) => {
          fixture.receipts[allocationTxHash].gasUsed = 1_000_000n;
        },
        /gas exceeds/,
      ],
      [
        (fixture) => {
          fixture.blocks[claimBlockHash].gasLimit = 1_000_000n;
        },
        /gas exceeds/,
      ],
      [
        (fixture) => {
          fixture.blocks[allocationBlockHash].number = 12;
        },
        /inclusion block/,
      ],
    ];
    for (const [change, expected] of cases) {
      const { provider } = fixtureProvider(change);
      await assert.rejects(verifyShieldedTestnetReceipts(input(provider)), expected);
    }
  });
});
