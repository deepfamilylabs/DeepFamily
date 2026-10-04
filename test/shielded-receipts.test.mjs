import assert from "node:assert/strict";
import { Interface, ZeroAddress } from "ethers";
import hre from "hardhat";

import {
  FUND_SELECTOR,
  CLAIM_SELECTOR,
  verifyShieldedReceipts,
} from "../scripts/lib/shieldedReceipts.mjs";

const poolAddress = "0x0000000000000000000000000000000000000071";
const fundTxHash = `0x${"11".repeat(32)}`;
const claimTxHash = `0x${"22".repeat(32)}`;
const fundBlockHash = `0x${"aa".repeat(32)}`;
const claimBlockHash = `0x${"bb".repeat(32)}`;

function fixtureProvider({ chainId = 71, change = () => {} } = {}) {
  const fixture = {
    chainId: `0x${chainId.toString(16)}`,
    providerChainId: BigInt(chainId),
    code: "0x6000",
    transactions: {
      [fundTxHash]: {
        hash: fundTxHash,
        chainId: BigInt(chainId),
        to: poolAddress,
        data: `${FUND_SELECTOR}abcd`,
        gasLimit: 900_000n,
        blockHash: fundBlockHash,
        blockNumber: 10,
      },
      [claimTxHash]: {
        hash: claimTxHash,
        chainId: BigInt(chainId),
        to: poolAddress,
        data: `${CLAIM_SELECTOR}abcd`,
        gasLimit: 1_500_000n,
        blockHash: claimBlockHash,
        blockNumber: 11,
      },
    },
    receipts: {
      [fundTxHash]: {
        hash: fundTxHash,
        to: poolAddress,
        status: 1,
        blockHash: fundBlockHash,
        blockNumber: 10,
        gasUsed: 800_000n,
      },
      [claimTxHash]: {
        hash: claimTxHash,
        to: poolAddress,
        status: 1,
        blockHash: claimBlockHash,
        blockNumber: 11,
        gasUsed: 1_200_000n,
      },
    },
    blocks: {
      [fundBlockHash]: { hash: fundBlockHash, number: 10, gasLimit: 30_000_000n },
      [claimBlockHash]: { hash: claimBlockHash, number: 11, gasLimit: 30_000_000n },
    },
    canonicalBlocks: {
      10: { hash: fundBlockHash, number: 10, gasLimit: 30_000_000n },
      11: { hash: claimBlockHash, number: 11, gasLimit: 30_000_000n },
    },
  };
  change(fixture);
  const calls = [];
  const blockLookups = [];
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
    getBlock: async (block) => {
      calls.push("getBlock");
      blockLookups.push(block);
      return (
        (typeof block === "number" ? fixture.canonicalBlocks[block] : fixture.blocks[block]) ?? null
      );
    },
  };
  return { provider, calls, blockLookups };
}

const input = (provider, expectedChainId = 71) => ({
  provider,
  expectedChainId,
  poolAddress,
  fundTxHash,
  claimTxHash,
});

describe("shielded receipt observer", function () {
  it("uses the pool's actual fund and claim ABI selectors", async function () {
    const artifact = await hre.artifacts.readArtifact("ShieldedErc20Pool");
    const abi = new Interface(artifact.abi);
    assert.equal(FUND_SELECTOR, abi.getFunction("fund").selector);
    assert.equal(CLAIM_SELECTOR, abi.getFunction("claim").selector);
  });

  it("requires an explicit positive safe chain ID before RPC lookups", async function () {
    for (const expectedChainId of [
      undefined,
      null,
      0,
      -1,
      71.5,
      "71",
      true,
      Number.MAX_SAFE_INTEGER + 1,
      0n,
    ]) {
      const { provider, calls } = fixtureProvider();
      await assert.rejects(
        verifyShieldedReceipts({ ...input(provider), expectedChainId }),
        /expectedChainId must be a positive safe integer/,
      );
      assert.deepEqual(calls, []);
    }
  });

  it("requires a pool and valid, distinct transaction hashes", async function () {
    for (const [overrides, expected] of [
      [{ poolAddress: "invalid" }, /valid EVM address/],
      [{ poolAddress: ZeroAddress }, /zero address/],
      [{ fundTxHash: "0x1234" }, /32-byte transaction hash/],
      [{ claimTxHash: "0x1234" }, /32-byte transaction hash/],
      [{ claimTxHash: fundTxHash }, /distinct/],
    ]) {
      const { provider, calls } = fixtureProvider();
      await assert.rejects(verifyShieldedReceipts({ ...input(provider), ...overrides }), expected);
      assert.deepEqual(calls, []);
    }
  });

  it("observes fund alone when no mature claim transaction is supplied", async function () {
    const { provider, calls } = fixtureProvider();
    const result = await verifyShieldedReceipts({ ...input(provider), claimTxHash: undefined });
    assert.deepEqual(Object.keys(result.transactions), ["fund"]);
    assert.equal(result.transactions.fund.txHash, fundTxHash);
    assert.equal(calls.filter((method) => method === "getTransaction").length, 1);
  });

  for (const chainId of [71, 11155111]) {
    it(`cross-checks successful pool receipts on chain ${chainId}`, async function () {
      const { provider, calls, blockLookups } = fixtureProvider({ chainId });
      const result = await verifyShieldedReceipts(input(provider, chainId));
      assert.deepEqual(result, {
        schema: "deepfamily/shielded-receipt-observation@1",
        chainId,
        poolAddress,
        rpcChecks: "passed",
        transactions: {
          fund: {
            txHash: fundTxHash,
            blockNumber: 10,
            blockHash: fundBlockHash,
            selector: FUND_SELECTOR,
            gasUsed: "800000",
            transactionGasLimit: "900000",
            blockGasLimit: "30000000",
          },
          claim: {
            txHash: claimTxHash,
            blockNumber: 11,
            blockHash: claimBlockHash,
            selector: CLAIM_SELECTOR,
            gasUsed: "1200000",
            transactionGasLimit: "1500000",
            blockGasLimit: "30000000",
          },
        },
      });
      assert.deepEqual(calls.slice(0, 2).sort(), ["eth_chainId", "getNetwork"]);
      assert.equal(calls.filter((method) => method === "getTransaction").length, 2);
      assert.ok(blockLookups.includes(fundBlockHash));
      assert.ok(blockLookups.includes(claimBlockHash));
      assert.ok(blockLookups.includes(10));
      assert.ok(blockLookups.includes(11));
      assert.ok(!calls.includes("sendTransaction"));
    });
  }

  it("accepts a bigint expected chain ID", async function () {
    const { provider } = fixtureProvider();
    const result = await verifyShieldedReceipts(input(provider, 71n));
    assert.equal(result.chainId, 71);
  });

  it("rejects a mismatched expected, raw or provider chain ID before receipt lookups", async function () {
    const cases = [
      { expectedChainId: 11155111 },
      {
        change: (fixture) => {
          fixture.chainId = "0x406";
        },
      },
      {
        change: (fixture) => {
          fixture.providerChainId = 1030n;
        },
      },
      {
        change: (fixture) => {
          fixture.chainId = "invalid";
        },
        expected: /invalid chain ID/,
      },
    ];
    for (const { expectedChainId = 71, change, expected = /requires chain ID/ } of cases) {
      const { provider, calls } = fixtureProvider({ change });
      await assert.rejects(verifyShieldedReceipts(input(provider, expectedChainId)), expected);
      assert.ok(!calls.includes("getTransaction"));
    }
  });

  it("rejects a transaction with a different chain ID", async function () {
    const { provider } = fixtureProvider({
      change: (fixture) => {
        fixture.transactions[claimTxHash].chainId = 11155111n;
      },
    });
    await assert.rejects(
      verifyShieldedReceipts(input(provider)),
      /Claim transaction does not have chain ID 71/,
    );
  });

  it("rejects a pool without deployed code before receipt lookups", async function () {
    const { provider, calls } = fixtureProvider({
      change: (fixture) => {
        fixture.code = "0x";
      },
    });
    await assert.rejects(verifyShieldedReceipts(input(provider)), /has no code on chain ID 71/);
    assert.ok(!calls.includes("getTransaction"));
  });

  it("rejects missing transactions, receipts, or inclusion blocks", async function () {
    for (const [change, expected] of [
      [
        (fixture) => {
          delete fixture.transactions[fundTxHash];
        },
        /transaction or receipt is missing/,
      ],
      [
        (fixture) => {
          delete fixture.receipts[claimTxHash];
        },
        /transaction or receipt is missing/,
      ],
      [
        (fixture) => {
          delete fixture.blocks[claimBlockHash];
        },
        /inclusion block is missing/,
      ],
      [
        (fixture) => {
          delete fixture.canonicalBlocks[10];
        },
        /not canonical/,
      ],
    ]) {
      const { provider } = fixtureProvider({ change });
      await assert.rejects(verifyShieldedReceipts(input(provider)), expected);
    }
  });

  it("rejects a reorged receipt block by rechecking its canonical height", async function () {
    const { provider, blockLookups } = fixtureProvider({
      change: (fixture) => {
        fixture.canonicalBlocks[11].hash = fundBlockHash;
      },
    });
    await assert.rejects(
      verifyShieldedReceipts(input(provider)),
      /Claim inclusion block is not canonical/,
    );
    assert.ok(blockLookups.includes(claimBlockHash));
    assert.ok(blockLookups.includes(11));
  });

  it("rejects failed receipts, wrong targets or selectors, and inconsistent gas or blocks", async function () {
    const cases = [
      [
        (fixture) => {
          fixture.receipts[claimTxHash].status = 0;
        },
        /did not succeed/,
      ],
      [
        (fixture) => {
          fixture.transactions[fundTxHash].to = "0x0000000000000000000000000000000000000002";
        },
        /selected shielded pool/,
      ],
      [
        (fixture) => {
          fixture.receipts[claimTxHash].to = null;
        },
        /selected shielded pool/,
      ],
      [
        (fixture) => {
          fixture.transactions[claimTxHash].data = `${FUND_SELECTOR}abcd`;
        },
        /wrong pool method selector/,
      ],
      [
        (fixture) => {
          fixture.receipts[claimTxHash].hash = fundTxHash;
        },
        /different transaction hash/,
      ],
      [
        (fixture) => {
          fixture.receipts[fundTxHash].gasUsed = 1_000_000n;
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
          fixture.receipts[fundTxHash].gasUsed = 0n;
        },
        /gas values must be positive/,
      ],
      [
        (fixture) => {
          fixture.transactions[claimTxHash].gasLimit = 0n;
        },
        /gas values must be positive/,
      ],
      [
        (fixture) => {
          fixture.blocks[claimBlockHash].gasLimit = 0n;
        },
        /gas values must be positive/,
      ],
      [
        (fixture) => {
          fixture.blocks[fundBlockHash].number = 12;
        },
        /inclusion block/,
      ],
      [
        (fixture) => {
          fixture.transactions[claimTxHash].blockHash = fundBlockHash;
        },
        /disagree on the inclusion block/,
      ],
      [
        (fixture) => {
          fixture.transactions[claimTxHash].blockNumber = 12;
        },
        /disagree on the inclusion block/,
      ],
      [
        (fixture) => {
          fixture.receipts[claimTxHash].blockHash = "0x1234";
        },
        /disagree on the inclusion block/,
      ],
    ];
    for (const [change, expected] of cases) {
      const { provider } = fixtureProvider({ change });
      await assert.rejects(verifyShieldedReceipts(input(provider)), expected);
    }
  });
});
