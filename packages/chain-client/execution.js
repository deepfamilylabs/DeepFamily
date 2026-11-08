import { operationForFailure, ownValue } from "./internal.js";
import { chainTrackingError, getTransactionErrorContext, normalizeChainError, withTransactionHash } from "./errors.js";
import { waitForExactTransactionReceipt } from "./receipts.js";

/** One read or estimate. Recovery and retries are caller policies. */
export async function runChainRead(input) {
  try { return await input.read(); }
  catch (error) { throw normalizeChainError(error, { ...input, operation: input.operation ?? "read" }); }
}

/** Send once, preserve its identity, then use the shared receipt and replacement policy. */
export async function executeChainTransaction(input) {
  let transaction;
  let transactionHash;
  let operation = "read";
  let confirmed = false;
  try {
    const fromBlock = input.fromBlock ?? (input.provider ? await input.provider.getBlockNumber() : undefined);
    if (fromBlock !== undefined && (!Number.isSafeInteger(fromBlock) || fromBlock < 0))
      throw chainTrackingError("Transaction submission block is unavailable", "INVALID_ARGUMENT");
    // The caller owns its pre-send check's stage (for example a wallet RPC read).
    operation = undefined;
    await input.beforeSend?.();
    operation = "submit";
    input.assertActive?.();
    transaction = await input.send();
    transactionHash = transaction?.hash;
    await input.onTransactionSubmitted?.(transaction);
    operation = "confirm";
    const response = fromBlock !== undefined && typeof transaction.replaceableTransaction === "function"
      ? transaction.replaceableTransaction(fromBlock) : transaction;
    const result = await waitForExactTransactionReceipt({
      ...input, transaction: response,
    });
    transactionHash = result.transactionHash;
    confirmed = Number(result.receipt.status) === 1;
    await input.onConfirmed?.(transactionHash, result.receipt);
    return { ...result, transaction };
  } catch (error) {
    const context = getTransactionErrorContext(error);
    const info = ownValue(error, "info");
    const knownHash = context.transactionHash ?? transactionHash ?? ownValue(info, "sendTransactionHash");
    if (!transaction && typeof knownHash === "string") {
      try { await input.onSubmitted?.(knownHash); }
      catch (trackingError) { throw normalizeChainError(withTransactionHash(trackingError, knownHash), { operation }); }
    }
    throw normalizeChainError(withTransactionHash(error, knownHash), {
      operation: transaction ? operation : operationForFailure(error, operation), ...(confirmed ? { transactionConfirmed: true } : {}),
    });
  }
}

/** Resume a journalled transaction by hash without guessing which replacement, if any, mined. */
export async function waitForTransactionHashReceipt(input) {
  const { transactionHash, provider } = input;
  return waitForExactTransactionReceipt({
    ...input, replacementPolicy: "reject",
    transaction: { hash: transactionHash, wait: (confirmations, timeoutMs) => provider.waitForTransaction(transactionHash, confirmations, timeoutMs) },
  });
}
