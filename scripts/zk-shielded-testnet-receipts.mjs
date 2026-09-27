#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, id, JsonRpcProvider, ZeroAddress } from "ethers";

const TESTNET_CHAIN_ID = 71n;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ACTION_DATA_SIGNATURE =
  "(uint256[2],uint256[2],uint256[2],uint256[12],uint256[2],bytes[2],uint256,uint256,uint256,uint256,uint256)";
export const ALLOCATE_SELECTOR = id(`allocate(${ACTION_DATA_SIGNATURE},bytes)`).slice(0, 10);
export const CLAIM_SELECTOR = id(`claim(${ACTION_DATA_SIGNATURE},bytes)`).slice(0, 10);

function requireTxHash(value, label) {
  if (!TX_HASH.test(value ?? "")) throw new Error(`${label} must be a 32-byte transaction hash`);
  return value.toLowerCase();
}

function requireAddress(value, label) {
  let address;
  try {
    address = getAddress(value);
  } catch {
    throw new Error(`${label} must be a valid EVM address`);
  }
  if (address === ZeroAddress) throw new Error(`${label} cannot be the zero address`);
  return address;
}

export function parseShieldedReceiptArguments(argv) {
  const options = {};
  const required = ["--rpc", "--pool", "--allocation-tx", "--claim12-tx"];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!required.includes(flag) || options[flag] !== undefined || !argv[index + 1]) {
      throw new Error(`Unexpected or incomplete receipt argument: ${flag ?? "none"}`);
    }
    options[flag] = argv[index + 1];
  }
  if (required.some((flag) => options[flag] === undefined)) {
    throw new Error(
      "Usage: node scripts/zk-shielded-testnet-receipts.mjs --rpc <chain-71-url> " +
        "--pool <address> --allocation-tx <hash> --claim12-tx <hash>",
    );
  }
  let rpc;
  try {
    rpc = new URL(options["--rpc"]);
  } catch {
    throw new Error("--rpc must be an explicit HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(rpc.protocol) || !rpc.hostname) {
    throw new Error("--rpc must be an explicit HTTP(S) URL");
  }
  const allocationTxHash = requireTxHash(options["--allocation-tx"], "--allocation-tx");
  const claim12TxHash = requireTxHash(options["--claim12-tx"], "--claim12-tx");
  if (allocationTxHash === claim12TxHash) {
    throw new Error("Allocation and claim must be distinct transactions");
  }
  return {
    rpcUrl: rpc.href,
    poolAddress: requireAddress(options["--pool"], "--pool"),
    allocationTxHash,
    claim12TxHash,
  };
}

async function assertChain71(provider) {
  const [raw, network] = await Promise.all([
    provider.send("eth_chainId", []),
    provider.getNetwork(),
  ]);
  let rawChainId;
  try {
    rawChainId = BigInt(raw);
  } catch {
    throw new Error("RPC returned an invalid raw chain ID");
  }
  if (rawChainId !== TESTNET_CHAIN_ID || BigInt(network.chainId) !== TESTNET_CHAIN_ID) {
    throw new Error(
      `Shielded receipt check requires chain ID 71; got raw=${rawChainId}, provider=${network.chainId}`,
    );
  }
}

async function checkTransaction(provider, { hash, poolAddress, selector, label }) {
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
  ]);
  if (!transaction || !receipt) throw new Error(`${label} transaction or receipt is missing`);
  if (transaction.hash.toLowerCase() !== hash || receipt.hash.toLowerCase() !== hash) {
    throw new Error(`${label} RPC returned a different transaction hash`);
  }
  if (BigInt(transaction.chainId) !== TESTNET_CHAIN_ID) {
    throw new Error(`${label} transaction does not have chain ID 71`);
  }
  if (receipt.status !== 1) throw new Error(`${label} transaction did not succeed`);
  if (
    transaction.to === null ||
    receipt.to === null ||
    getAddress(transaction.to) !== poolAddress ||
    getAddress(receipt.to) !== poolAddress
  ) {
    throw new Error(`${label} transaction did not call the selected shielded pool`);
  }
  if (transaction.data.slice(0, 10).toLowerCase() !== selector) {
    throw new Error(`${label} transaction has the wrong pool method selector`);
  }
  if (
    !receipt.blockHash ||
    !Number.isSafeInteger(receipt.blockNumber) ||
    receipt.blockNumber < 0 ||
    (transaction.blockHash &&
      transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase())
  ) {
    throw new Error(`${label} transaction and receipt disagree on the inclusion block`);
  }
  const block = await provider.getBlock(receipt.blockHash);
  if (
    !block ||
    block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    block.number !== receipt.blockNumber
  ) {
    throw new Error(`${label} inclusion block is missing or inconsistent`);
  }
  const used = BigInt(receipt.gasUsed);
  const transactionLimit = BigInt(transaction.gasLimit);
  const blockLimit = BigInt(block.gasLimit);
  if (used <= 0n || transactionLimit <= 0n || blockLimit <= 0n) {
    throw new Error(`${label} gas values must be positive`);
  }
  if (used > transactionLimit || transactionLimit > blockLimit) {
    throw new Error(`${label} gas exceeds its transaction or block gas limit`);
  }
  return {
    txHash: hash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    selector,
    gasUsed: used.toString(),
    transactionGasLimit: transactionLimit.toString(),
    blockGasLimit: blockLimit.toString(),
  };
}

/** Read-only RPC cross-check. It cannot establish private period counts or synthetic path depth. */
export async function verifyShieldedTestnetReceipts({
  provider,
  poolAddress,
  allocationTxHash,
  claim12TxHash,
}) {
  const pool = requireAddress(poolAddress, "pool address");
  const allocationHash = requireTxHash(allocationTxHash, "allocation transaction");
  const claimHash = requireTxHash(claim12TxHash, "12-period claim transaction");
  if (allocationHash === claimHash)
    throw new Error("Allocation and claim must be distinct transactions");
  await assertChain71(provider);
  if ((await provider.getCode(pool)) === "0x") {
    throw new Error("Selected shielded pool address has no code on chain ID 71");
  }
  const [allocation, claim12] = await Promise.all([
    checkTransaction(provider, {
      hash: allocationHash,
      poolAddress: pool,
      selector: ALLOCATE_SELECTOR,
      label: "Allocation",
    }),
    checkTransaction(provider, {
      hash: claimHash,
      poolAddress: pool,
      selector: CLAIM_SELECTOR,
      label: "Claim",
    }),
  ]);
  return {
    schema: "deepfamily/shielded-testnet-receipt-observation@1",
    chainId: Number(TESTNET_CHAIN_ID),
    poolAddress: pool,
    rpcChecks: "passed",
    privateClaimedPeriodsChecked: false,
    fullPathDepthChecked: false,
    releaseEvidence: false,
    transactions: { allocation, claim12 },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseShieldedReceiptArguments(process.argv.slice(2));
    const provider = new JsonRpcProvider(options.rpcUrl);
    const result = await verifyShieldedTestnetReceipts({ provider, ...options });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[zk-shielded-testnet-receipts] ${error.message}`);
    process.exitCode = 1;
  }
}
