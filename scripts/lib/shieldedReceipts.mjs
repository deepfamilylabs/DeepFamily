import { getAddress, id, ZeroAddress } from "ethers";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ACTION_DATA_SIGNATURE =
  "(uint256[2],uint256[2],uint256[2],uint256[12],uint256[2],bytes[2],uint256,uint256,uint256,uint256,uint256)";
export const FUND_SELECTOR = id(`fund(${ACTION_DATA_SIGNATURE},bytes)`).slice(0, 10);
export const CLAIM_SELECTOR = id(`claim(${ACTION_DATA_SIGNATURE},bytes)`).slice(0, 10);

function requireTxHash(value, label) {
  if (typeof value !== "string" || !TX_HASH.test(value)) {
    throw new Error(`${label} must be a 32-byte transaction hash`);
  }
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

function requireChainId(value) {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("expectedChainId must be a positive safe integer");
  }
  return BigInt(value);
}

async function assertChain(provider, expectedChainId) {
  const [raw, network] = await Promise.all([
    provider.send("eth_chainId", []),
    provider.getNetwork(),
  ]);
  let rawChainId;
  let providerChainId;
  try {
    rawChainId = BigInt(raw);
    providerChainId = BigInt(network.chainId);
  } catch {
    throw new Error("RPC returned an invalid chain ID");
  }
  if (rawChainId !== expectedChainId || providerChainId !== expectedChainId) {
    throw new Error(
      `Shielded receipt check requires chain ID ${expectedChainId}; got raw=${rawChainId}, provider=${providerChainId}`,
    );
  }
}

async function checkTransaction(provider, { hash, expectedChainId, poolAddress, selector, label }) {
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(hash),
    provider.getTransactionReceipt(hash),
  ]);
  if (!transaction || !receipt) throw new Error(`${label} transaction or receipt is missing`);
  if (
    String(transaction.hash ?? "").toLowerCase() !== hash ||
    String(receipt.hash ?? "").toLowerCase() !== hash
  ) {
    throw new Error(`${label} RPC returned a different transaction hash`);
  }
  let transactionChainId;
  try {
    transactionChainId = BigInt(transaction.chainId);
  } catch {
    throw new Error(`${label} transaction has an invalid chain ID`);
  }
  if (transactionChainId !== expectedChainId) {
    throw new Error(`${label} transaction does not have chain ID ${expectedChainId}`);
  }
  if (receipt.status !== 1) throw new Error(`${label} transaction did not succeed`);
  let transactionTarget;
  let receiptTarget;
  try {
    transactionTarget = getAddress(transaction.to);
    receiptTarget = getAddress(receipt.to);
  } catch {
    throw new Error(`${label} transaction did not call the selected shielded pool`);
  }
  if (transactionTarget !== poolAddress || receiptTarget !== poolAddress) {
    throw new Error(`${label} transaction did not call the selected shielded pool`);
  }
  if (
    typeof transaction.data !== "string" ||
    transaction.data.slice(0, 10).toLowerCase() !== selector
  ) {
    throw new Error(`${label} transaction has the wrong pool method selector`);
  }
  if (
    !TX_HASH.test(receipt.blockHash ?? "") ||
    !Number.isSafeInteger(receipt.blockNumber) ||
    receipt.blockNumber < 0 ||
    (transaction.blockHash &&
      transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) ||
    (transaction.blockNumber != null && transaction.blockNumber !== receipt.blockNumber)
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
  const canonicalBlock = await provider.getBlock(receipt.blockNumber);
  if (
    !canonicalBlock ||
    canonicalBlock.number !== receipt.blockNumber ||
    canonicalBlock.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()
  ) {
    throw new Error(`${label} inclusion block is not canonical`);
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

/** Read-only RPC checks cover public receipts, not private period counts or witness depth. */
export async function verifyShieldedReceipts({
  provider,
  expectedChainId,
  poolAddress,
  fundTxHash,
  claimTxHash,
}) {
  const chainId = requireChainId(expectedChainId);
  const pool = requireAddress(poolAddress, "pool address");
  const fundHash = requireTxHash(fundTxHash, "fund transaction");
  const claimHash =
    claimTxHash === undefined ? undefined : requireTxHash(claimTxHash, "claim transaction");
  if (fundHash === claimHash) {
    throw new Error("Fund and claim must be distinct transactions");
  }
  await assertChain(provider, chainId);
  if ((await provider.getCode(pool)) === "0x") {
    throw new Error(`Selected shielded pool address has no code on chain ID ${chainId}`);
  }
  const [fund, claim] = await Promise.all([
    checkTransaction(provider, {
      hash: fundHash,
      expectedChainId: chainId,
      poolAddress: pool,
      selector: FUND_SELECTOR,
      label: "Fund",
    }),
    claimHash === undefined
      ? undefined
      : checkTransaction(provider, {
          hash: claimHash,
          expectedChainId: chainId,
          poolAddress: pool,
          selector: CLAIM_SELECTOR,
          label: "Claim",
        }),
  ]);
  return {
    schema: "deepfamily/shielded-receipt-observation@1",
    chainId: Number(chainId),
    poolAddress: pool,
    rpcChecks: "passed",
    transactions: { fund, ...(claim === undefined ? {} : { claim }) },
  };
}
